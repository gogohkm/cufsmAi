/**
 * K2-5 — MCP 설계 도구의 인자 → 검토 상태(결정 1). 순수 모듈.
 *
 * 설계 도구(aisi_design_* · design_purlin · analyze_loads · design_connection · design_lap_connection)는 받은 인자로만 계산하고(엔진 요청은
 * 지금 그대로), 그 뒤 **그 도구의 인자 묶음을 통째로** 상태에 쓴다: 묶음의 키 가운데 받은 것은 그 값, 받지 않은 것은 null(「AI: 주지 않음」).
 * 예외 — 재료(Fy · Fu)와 설계법, 부재 유형은 여러 묶음이 같이 쓰므로 받았을 때만 쓴다(합치기). 화면 칸이 없는 인자는 mcpOnly[도구] 에.
 */
import { InputValue, SpanTable } from './caseState';

const DS = require('../../webview/js/designState');

export interface McpWrite {
    tool: string;
    /** 통째로 쓰는 묶음(받지 않은 키는 null) */
    group: Record<string, InputValue>;
    /** 받았을 때만 쓰는 키 */
    merge: Record<string, InputValue>;
    /** 경간 표(받았을 때만) */
    spans?: SpanTable;
    /** 화면 칸이 없는 인자 — mcpOnly[tool] 를 이것으로 바꾼다 */
    mcpOnly: Record<string, unknown>;
    /** 상태에 쓰지 못한 인자와 까닭(선택지가 아님 · 수가 아님 …) */
    skipped: { arg: string; reason: string }[];
}

/** 응답의 모양 · 위치 인자(계산 조건이 아니다) — 상태에 남기지 않는다 */
const NOT_CONDITIONS = new Set(['action', 'units', 'detail', 'check_location', 'check_combination', 'member_type', '__tool']);

type Mapper = (args: any, w: McpWrite) => void;

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

function put(w: McpWrite, where: 'group' | 'merge', key: string, value: unknown, arg: string): void {
    if (value === undefined) { return; }
    const err = value === null ? null : DS.validateValue(key, value);
    if (err) { w.skipped.push({ arg, reason: err }); return; }
    w[where][key] = value as InputValue;
}

/** 묶음의 키를 먼저 모두 null 로(받지 않음), 그 뒤 받은 것을 얹는다 */
function blank(w: McpWrite, keys: string[]): void { for (const k of keys) { w.group[k] = null; } }

/** 인자 → 키 (같은 값). 받은 인자만 */
function direct(args: any, w: McpWrite, table: Record<string, string>, used: Set<string>): void {
    for (const [arg, key] of Object.entries(table)) {
        if (args[arg] === undefined) { continue; }
        used.add(arg);
        put(w, 'group', key, args[arg], arg);
    }
}

function rest(args: any, w: McpWrite, used: Set<string>): void {
    for (const [k, v] of Object.entries(args || {})) {
        if (used.has(k) || NOT_CONDITIONS.has(k) || v === undefined) { continue; }
        w.mcpOnly[k] = v;
    }
}

function material(args: any, w: McpWrite, used: Set<string>, keys: { Fy?: string; Fu?: string } = { Fy: 'fy', Fu: 'fu' }): void {
    for (const [arg, key] of Object.entries(keys)) {
        if (args[arg] === undefined || !key) { continue; }
        used.add(arg);
        put(w, 'merge', key, args[arg], arg);
    }
    if (args.design_method !== undefined) { used.add('design_method'); put(w, 'merge', 'designMethod', args.design_method, 'design_method'); }
}

/** R 계수(값 + 경간 조건) → 선택지 */
function rOption(R: unknown, span: unknown): string | null {
    const m = DS.fieldMeta('rValue');
    const opts: string[] = m.opts;
    const idx = opts.map((o, i) => ({ o, i })).filter(({ o }) => parseFloat(o) === Number(R));
    const hit = idx.find(({ i }) => m.optSpan[i] === span) || idx[0];
    return hit ? hit.o : null;
}

const WC: Record<string, string> = {
    wc_N: 'wcN', wc_R: 'wcR', wc_fastened: 'wcFastened', wc_web_config: 'wcWebConfig', wc_section_family: 'wcFamily',
    wc_flange_condition: 'wcFlangeCondition', wc_overhang: 'wcLo', wc_edge_distance: 'wcEdgeDistance', wc_n_webs: 'wcNWebs',
    wc_support_fastener_spacing: 'wcFastenerSpacing',
};
const USE: Record<string, string> = { use_inelastic_reserve: 'chkInelasticReserve', use_cold_work: 'chkColdWork' };

const memberFlexure: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    w.merge.memberType = 'flexure';
    blank(w, ['Lb', 'Cb', 'Mux', 'Vu', 'designLbPos', 'designCbPos', 'designMxPos', 'wcP', 'wcSupport', 'chkRFactor', 'rValue',
        'chkBetaDist', 'distM1M2', 'distLm', ...Object.values(WC), ...Object.values(USE)]);
    direct(a, w, { Lb: 'Lb', Cb: 'Cb', Mu: 'Mux', Vu: 'Vu', Lb_pos: 'designLbPos', Cb_pos: 'designCbPos', Mu_pos: 'designMxPos',
        wc_P: 'wcP', wc_support: 'wcSupport', dist_M1_M2: 'distM1M2', dist_Lm: 'distLm', ...WC, ...USE }, used);
    if (a.dist_M1_M2 !== undefined || a.dist_Lm !== undefined) { w.group.chkBetaDist = true; }
    if (a.R_uplift !== undefined) {
        used.add('R_uplift'); used.add('span_type');
        const opt = rOption(a.R_uplift, a.span_type);
        if (opt) { w.group.chkRFactor = true; w.group.rValue = opt; }
        else { w.skipped.push({ arg: 'R_uplift', reason: `R ${a.R_uplift} (${a.span_type ?? '경간 조건 없음'}) 은(는) 화면의 표 I6.2.1-1 선택지에 없다` }); w.mcpOnly.R_uplift = a.R_uplift; if (a.span_type !== undefined) { w.mcpOnly.span_type = a.span_type; } }
    }
    rest(a, w, used);
};

const memberCompression: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    w.merge.memberType = 'compression';
    blank(w, ['KxLx', 'KyLy', 'KtLt', 'Pu']);
    direct(a, w, { KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Pu: 'Pu' }, used);
    rest(a, w, used);
};

const memberCombined: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    w.merge.memberType = 'combined';
    blank(w, ['KxLx', 'KyLy', 'KtLt', 'Lb', 'Cb', 'Cmx', 'Cmy', 'chkBetaDist', 'distM1M2', 'Pu', 'Mux', 'Muy', 'MayStrength', 'Vu']);
    direct(a, w, { KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Lb: 'Lb', Cb: 'Cb', Cmx: 'Cmx', Cmy: 'Cmy', dist_M1_M2: 'distM1M2',
        Pu: 'Pu', Mux: 'Mux', Muy: 'Muy', May_strength: 'MayStrength', Vu: 'Vu' }, used);
    if (a.dist_M1_M2 !== undefined) { w.group.chkBetaDist = true; }
    rest(a, w, used);
};

const memberTension: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    w.merge.memberType = 'tension';
    blank(w, ['Pu']);
    direct(a, w, { Tu: 'Pu' }, used);   // 화면은 Pu 칸 하나를 인장 Tu 로도 쓴다
    rest(a, w, used);
};

const SPAN_OPTS = ['simple', 'cantilever', 'cont-2', 'cont-3', 'cont-4'];

function loadsLike(withDesign: boolean): Mapper {
    return (a, w) => {
        const used = new Set<string>();
        material(a, w, used);
        if (a.member_app !== undefined) { used.add('member_app'); put(w, 'merge', 'memberType', a.member_app, 'member_app'); }
        const groupKeys = ['spanType', 'nSpans', 'spacing', 'loadD', 'loadLr', 'loadS', 'loadWu', 'loadWp', 'loadL', 'chkPatternLoading',
            'chkLrReduced', 'spanIxIn4', 'deckType', 'deckTPanel', 'deckFastenerSpacing', 'deckKphiOverride', 'deckKxOverride',
            'bracePointsFt', 'chkI621Confirmed', 'deckInsulationIn', 'deckRTested'];
        if (withDesign) { groupKeys.push(...Object.values(WC), ...Object.values(USE), 'lapRestrained'); }
        blank(w, groupKeys);
        // 경간 유형 · 수
        let n: number | null = null;
        if (typeof a.span_type === 'string') {
            used.add('span_type');
            const m = /^cont-(\d+)$/.exec(a.span_type);
            if (SPAN_OPTS.includes(a.span_type)) { w.group.spanType = a.span_type; n = DS.spanCount(a.span_type, 0); }
            else if (m) { w.group.spanType = 'cont-n'; w.group.nSpans = Number(m[1]); n = Number(m[1]); }
            else { w.skipped.push({ arg: 'span_type', reason: `경간 유형 ${a.span_type} 은(는) 화면의 선택지가 아니다` }); }
        }
        const spacing = num(a.spacing_ft);
        if (a.spacing_ft !== undefined) { used.add('spacing_ft'); put(w, 'group', 'spacing', a.spacing_ft, 'spacing_ft'); }
        // 하중: 엔진은 선하중(plf = psf × 간격) — 화면은 면압(psf)
        if (a.loads && typeof a.loads === 'object') {
            used.add('loads');
            const L = a.loads;
            const extra: Record<string, unknown> = {};
            if (spacing && spacing > 0) {
                const psf = (v: unknown) => (num(v) === null ? undefined : (num(v) as number) / spacing);
                const t: Record<string, string> = { D: 'loadD', Lr: 'loadLr', S: 'loadS', Wp: 'loadWp', L: 'loadL' };
                for (const [k, key] of Object.entries(t)) { const v = psf(L[k]); if (v !== undefined) { put(w, 'group', key, v, `loads.${k}`); } }
                if (num(L.W) !== null) { put(w, 'group', 'loadWu', -(L.W as number) / spacing, 'loads.W'); }
            } else {
                w.skipped.push({ arg: 'loads', reason: 'spacing_ft 가 없어 선하중(plf)을 화면의 면압(psf)으로 바꿀 수 없다' });
                Object.assign(extra, L);
            }
            for (const [k, v] of Object.entries(L)) { if (!['D', 'Lr', 'S', 'W', 'Wp', 'L'].includes(k)) { extra[k] = v; } }
            if (Object.keys(extra).length) { w.mcpOnly.loads = extra; }
        }
        direct(a, w, { pattern_loading: 'chkPatternLoading', lr_reduced: 'chkLrReduced', I_span_in4: 'spanIxIn4',
            brace_points_ft: 'bracePointsFt', i621_conditions_confirmed: 'chkI621Confirmed', insulation_in: 'deckInsulationIn' }, used);
        if (a.deck && typeof a.deck === 'object') {
            used.add('deck');
            const d = a.deck;
            const t: Record<string, string> = { type: 'deckType', t_panel: 'deckTPanel', fastener_spacing: 'deckFastenerSpacing',
                kphi_override: 'deckKphiOverride', kx_override: 'deckKxOverride', R_tested_uplift: 'deckRTested' };
            const extra: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(d)) { if (t[k]) { put(w, 'group', t[k], v, `deck.${k}`); } else { extra[k] = v; } }
            if (Object.keys(extra).length) { w.mcpOnly.deck = extra; }
        }
        if (withDesign) {
            direct(a, w, { ...WC, ...USE }, used);
            // 계약 §6.3: lap_restrained(옛 이름 distortion_restrained 도) → 검토 상태의 lapRestrained
            if (a.lap_restrained !== undefined || a.distortion_restrained !== undefined) {
                used.add('lap_restrained'); used.add('distortion_restrained');
                put(w, 'group', 'lapRestrained', (a.lap_restrained ?? a.distortion_restrained) === true, 'lap_restrained');
            }
        }
        // 경간 표
        if (Array.isArray(a.spans_ft) || Array.isArray(a.supports) || Array.isArray(a.laps_per_support)) {
            for (const k of ['spans_ft', 'supports', 'laps_per_support', 'span_ft', 'laps']) { if (a[k] !== undefined) { used.add(k); } }
            const st = typeof w.group.spanType === 'string' ? w.group.spanType : 'simple';
            const count = n ?? DS.spanCount(st, Number(w.group.nSpans) || 0);
            const table: SpanTable = DS.defaultSpanTable(st, Number(w.group.nSpans) || 0);
            if (Array.isArray(a.spans_ft)) { table.spans = a.spans_ft.map((v: unknown) => num(v)); }
            else if (num(a.span_ft) !== null) { table.spans = table.spans.map(() => a.span_ft); }
            if (Array.isArray(a.supports)) { table.supports = [...a.supports]; }
            if (Array.isArray(a.laps_per_support)) {
                table.lapsPerSupport = table.lapsPerSupport.map((cell: { left: number | null; right: number | null }, i: number) => {
                    const l = a.laps_per_support[i] || {};
                    return { left: cell.left === null ? null : (num(l.left_ft) ?? 0), right: cell.right === null ? null : (num(l.right_ft) ?? 0) };
                });
            }
            const errs = DS.validateSpanTable(table, st, Number(w.group.nSpans) || count);
            if (errs.length) { w.skipped.push({ arg: 'spans_ft / supports / laps_per_support', reason: errs.join(' · ') }); }
            else { w.spans = table; }
        }
        rest(a, w, used);
    };
}

const connection: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used, {});   // 접합의 Fy · Fu 는 접합 칸(connFy · connFu) — 아래
    const t: Record<string, string> = { connection_type: 'connSingleType', t1: 'connT1', t2: 'connT2', d: 'connD', n: 'connN',
        Fy: 'connFy', Fu: 'connFu', Pu: 'connPu', Tu: 'connTu', e: 'connE', s: 'connS', width: 'connWidth', member_case: 'connMemberCase',
        j6_3_not_applicable: 'connJ63NotApplicable', dw: 'connDw', Pnvs: 'connPnvs', weld_length: 'connWeldL', weld_size: 'connWeldSize',
        groove_type: 'connGrooveType', Fub: 'connFub', Fuf: 'connFuf' };
    blank(w, Object.values(t));
    direct(a, w, t, used);
    rest(a, w, used);
};

const lap: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    const t: Record<string, string> = { lap_left_in: 'connLapLeft', lap_right_in: 'connLapRight', Mu_support: 'connMu', Vu_support: 'connVu',
        fastener_type: 'connFastenerType', fastener_dia: 'connFastenerDia', n_rows: 'connNRows', end_distance: 'connEdgeDist', Pnvs: 'connLapPnvs' };
    blank(w, [...Object.values(t), 'lapRestrained']);
    direct(a, w, t, used);
    // 계약 §6.3: 랩 구속의 진술(옛 이름 distortion_restrained) — 퍼린과 같은 검토 상태 키
    if (a.lap_restrained !== undefined || a.distortion_restrained !== undefined) {
        used.add('lap_restrained'); used.add('distortion_restrained');
        put(w, 'group', 'lapRestrained', (a.lap_restrained ?? a.distortion_restrained) === true, 'lap_restrained');
    }
    rest(a, w, used);   // d · t(단면 — 모델 칸) · Se · Sf · Mnd · Vn … 은 mcpOnly
};

/** 호스트 action(+ member_type) → 그 MCP 도구의 이름과 매퍼. 상태에 쓰지 않는 action 이면 null */
export function mcpGroupFor(action: string, options: any): { tool: string; map: Mapper } | null {
    switch (action) {
        case 'aisi_design':
            switch (options?.member_type) {
                case 'flexure': return { tool: 'aisi_design_flexure', map: memberFlexure };
                case 'compression': return { tool: 'aisi_design_compression', map: memberCompression };
                case 'combined': return { tool: 'aisi_design_combined', map: memberCombined };
                case 'tension': return { tool: 'aisi_design_tension', map: memberTension };
                case 'connection': return { tool: 'aisi_design_connection', map: connection };
                default: return null;
            }
        case 'design_purlin': return { tool: 'design_purlin', map: loadsLike(true) };
        case 'analyze_loads': return { tool: 'analyze_loads', map: loadsLike(false) };
        case 'design_connection': return { tool: 'design_connection', map: connection };
        case 'lap_connection': return { tool: 'design_lap_connection', map: lap };
        default: return null;
    }
}

/** MCP 도구의 인자(US) → 상태에 쓸 것 */
export function mcpWrite(action: string, options: any): McpWrite | null {
    const g = mcpGroupFor(action, options);
    if (!g) { return null; }
    const w: McpWrite = { tool: g.tool, group: {}, merge: {}, mcpOnly: {}, skipped: [] };
    g.map(options || {}, w);
    return w;
}
