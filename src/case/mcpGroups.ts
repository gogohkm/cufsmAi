/**
 * K2-5 · 결정 D1 · D8(2026-11-24) — MCP 설계 도구의 인자 → 검토 상태. 순수 모듈.
 *
 * 설계 도구(aisi_design_* · design_purlin · analyze_loads · design_connection · design_lap_connection)는 **받은 인자의 키만** 상태에
 * 합친다(주지 않은 칸은 그대로 — K2 결정 1 의 「묶음을 통째로」 를 뒤집었다). 묶음 인자(loads · deck)는 묶음째로: 준 묶음에서 빠진 성분은
 * 화면의 값이 아니라 「주지 않음」(null). 경간 표도 묶음째로 — 경간 · 지점 · 랩의 인자를 하나라도 받으면 그 경간 유형의 처음 표에 받은 부분.
 * 계산은 합친 상태로 만든 화면 단추의 본문(requests.ts)에 화면 칸이 없는 인자(mcpOnly)와 계산 조건이 아닌 인자(context)를 얹어서 한다
 * (StcfsdPanel._mcpDesign — mcpBody). 화면 칸이 없는 인자는 mcpOnly[도구] 에.
 */
import { CaseState, InputValue, SectionDef, SpanTable } from './caseState';

const DS = require('../../webview/js/designState');

export interface McpWrite {
    tool: string;
    /** 묶음째로 쓰는 키 — 묶음 인자(loads · deck)의 화면 칸. 준 묶음에서 빠진 성분은 null */
    group: Record<string, InputValue>;
    /** 받은 키(합치기) */
    merge: Record<string, InputValue>;
    /** 경간 표 — 묶음째(경간 · 지점 · 랩의 인자를 하나라도 받으면 그 경간 유형의 처음 표 + 받은 부분). 받지 않았으면 없음(화면의 표) */
    spans?: SpanTable;
    /** 결정 S1: 단면 목록(S2 …) — 받으면 통째로(받은 목록이 새 목록) */
    sections?: SectionDef[];
    /** 결정 S1: 경간의 단면 — span_sections 만 받았을 때(경간 표를 함께 받으면 그 표의 spanSections) */
    spanSections?: string[];
    /** 검증 2026-11-28 의 2: 주지 않아 S1 의 값으로 채운 치수(단면마다 — 답의 알림) */
    sectionsFilled?: Array<{ id: string | null; dims: Record<string, number> }>;
    /** 검증 2026-11-28 의 4: 경간 표를 span_sections 없이 받아 모든 경간을 S1 로 둠(단면 목록이 있을 때 — 답의 알림) */
    spanSectionsReset?: boolean;
    /** 화면 칸이 없는 인자 — mcpOnly[tool] 를 이것으로 바꾸고, 그 호출의 본문에 얹는다 */
    mcpOnly: Record<string, unknown>;
    /** 계산 조건이 아닌 인자(check_location · check_combination) — 그 호출의 본문에만 얹는다(상태에 남기지 않는다) */
    context: Record<string, unknown>;
    /** 그 호출의 본문에서 빼는 키(받은 인자가 상태의 짝을 대신할 때 — 표에 없는 R_uplift 의 경간 조건) */
    unset: string[];
    /** 그 호출의 본문을 만들 때 모델 칸 대신 쓰는 값(랩의 d · t → tplH · tplT) */
    drafts: Record<string, InputValue>;
    /** 그 도구의 본문이 읽는 검토 상태의 칸(응답의 case_inputs_used 를 고른다) */
    reads: string[];
    /**
     * 상태에 쓰지 못한 인자와 까닭(선택지가 아님 · 수가 아님 …). carried = 상태에는 못 썼지만 그 호출의 본문에는 받은 그대로 간다
     * (mcpOnly — 표에 없는 R_uplift 등). carried 가 아닌 것이 있으면 그 호출은 계산하지 않는다(화면의 값으로 바꿔 계산하지 않게).
     */
    skipped: { arg: string; reason: string; carried?: boolean }[];
}

/** 응답의 모양 인자(계산 조건이 아니다) — 상태에도 본문에도 넣지 않는다 */
const NOT_CONDITIONS = new Set(['action', 'units', 'detail', 'member_type', '__tool']);
/** 위치 · 조합 꼬리표 — 본문에만 얹는다 */
const CONTEXT_ARGS = new Set(['check_location', 'check_combination']);

/** 지금 상태(경간 표의 바탕 · 하중 환산의 간격) — 없으면 처음 상태처럼 */
type Cur = (Pick<CaseState, 'inputs' | 'spans'> & { sections?: SectionDef[] }) | null | undefined;
/** 결정 S1: 단면 목록의 템플릿(지금 모델의 것 — 모델이 템플릿 단면이 아니면 null) */
export interface McpWriteContext { template?: string | null; /** 검증 2026-11-28 의 2: S1(모델)의 템플릿 치수 — 주지 않은 치수를 채운다 */ params?: Record<string, unknown> | null }
type Mapper = (args: any, w: McpWrite, cur: Cur, mctx?: McpWriteContext) => void;

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function put(w: McpWrite, where: 'group' | 'merge', key: string, value: unknown, arg: string): void {
    if (value === undefined) { return; }
    const err = value === null ? null : DS.validateValue(key, value);
    if (err) { w.skipped.push({ arg, reason: err }); return; }
    w[where][key] = value as InputValue;
}

/** 인자 → 키 (같은 값). 받은 인자만(합치기) */
function direct(args: any, w: McpWrite, table: Record<string, string>, used: Set<string>): void {
    for (const [arg, key] of Object.entries(table)) {
        if (args[arg] === undefined) { continue; }
        used.add(arg);
        put(w, 'merge', key, args[arg], arg);
    }
}

function rest(args: any, w: McpWrite, used: Set<string>): void {
    for (const [k, v] of Object.entries(args || {})) {
        if (used.has(k) || NOT_CONDITIONS.has(k) || v === undefined) { continue; }
        if (CONTEXT_ARGS.has(k)) { w.context[k] = v; continue; }
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

const MATERIAL_READS = ['fy', 'fu', 'designMethod'];
const COMP_READS = ['KxLx', 'KyLy', 'KtLt', 'Pu'];
const FLEX_READS = ['Lb', 'Cb', 'Mux', 'Vu', 'designLbPos', 'designCbPos', 'designMxPos', 'wcP', 'wcSupport', 'chkRFactor', 'rValue',
    'chkBetaDist', 'distM1M2', 'distLm', ...Object.values(WC), ...Object.values(USE)];

// 결정 T7(2026-11-26): 웹 구멍 · 횡방향 웹 보강재 · §H4 — 엔진 인자 → 검토 상태의 칸(화면 칸과 같은 키). 계산은 그 칸으로 만든 화면 단추의
// 본문(designState.memberWebOptions)이다 — 구역이 「없음」 이면 칸에 써도 본문에 가지 않으므로, 인자가 그 구역을 연다(아래 webArgs).
const HOLE_ARGS: Record<string, string> = { hole_depth: 'holeDepth', hole_length: 'holeLength', hole_spacing: 'holeSpacing',
    hole_end_distance: 'holeEndDistance', hole_web_offset: 'holeWebOffset', hole_corner_radius: 'holeCornerRadius',
    hole_edge_stiffened: 'holeEdgeStiffened', hole_bearing_distance: 'holeBearingDistance', hole_within_bearing: 'holeWithinBearing' };
const STIFFENER_ARGS: Record<string, string> = { stiffener_spacing: 'stiffenerSpacing', stiffener_kind: 'stiffenerKind',
    stiffener_Is: 'stiffenerIs', stiffener_area: 'stiffenerArea', stiffener_Fy: 'stiffenerFy' };
const TORSION_DIRECT_ARGS: Record<string, string> = { torsion_f_bending: 'torsionFBending', torsion_f_torsion: 'torsionFTorsion',
    torsion_f_bending_max: 'torsionFBendingMax', torsion_at_web_flange_junction: 'torsionAtJunction' };
const TORSION_ECCENTRIC_ARGS: Record<string, string> = { torsion_eccentricity: 'torsionEccentricity', torsion_span: 'torsionSpan',
    torsion_load: 'torsionLoad', torsion_support: 'torsionSupport' };
const HOLE_READS = ['holeShape', ...Object.values(HOLE_ARGS)];
const STIFFENER_READS = ['stiffenerMode', ...Object.values(STIFFENER_ARGS)];
const TORSION_READS = ['torsionMode', ...Object.values(TORSION_DIRECT_ARGS), ...Object.values(TORSION_ECCENTRIC_ARGS)];

/**
 * 결정 T7: 구멍 · 보강재 · §H4 의 인자(받은 것만 — 합치기). parts: 그 도구가 받는 구역.
 * - hole_shape('none' | 'circular' | 'noncircular') → holeShape. 다른 hole_* 만 받았는데 화면의 구역이 「없음」 이면 계산하지 않는다
 *   (어느 모양인지 모른다 — 엔진도 hole_shape 없는 구멍 입력을 오류로 답한다).
 * - transverse_stiffeners → stiffenerMode(true 있음 · false 없음). stiffener_* 를 받으면(transverse_stiffeners: false 가 아니면) 「있음」 —
 *   엔진도 보강재 자료를 받으면 보강재가 있는 웹으로 본다.
 * - torsion_f_* → torsionMode 'direct', 그것 없이 torsion_eccentricity · span · load · support → 'eccentric'(둘 다 받으면 직접 — 엔진의 규칙).
 */
function webArgs(a: any, w: McpWrite, used: Set<string>, cur: Cur, parts: { holes?: boolean; stiffeners?: boolean; torsion?: boolean }): void {
    const given = (t: Record<string, string>) => Object.keys(t).filter((k) => a[k] !== undefined);
    if (parts.holes) {
        w.reads.push(...HOLE_READS);
        if (a.hole_shape !== undefined) { used.add('hole_shape'); put(w, 'merge', 'holeShape', a.hole_shape, 'hole_shape'); }
        const hs = given(HOLE_ARGS);
        direct(a, w, HOLE_ARGS, used);
        const shapeNow = a.hole_shape !== undefined ? a.hole_shape : (cur ? cur.inputs.holeShape : 'none');
        if (hs.length && !(shapeNow === 'circular' || shapeNow === 'noncircular')) {
            w.skipped.push({ arg: hs.join(', '), reason: "구멍 모양(hole_shape 'circular' · 'noncircular')을 함께 주어야 한다 — 화면의 「웹 구멍」 구역이 「없음」 이라 그 값으로는 구멍을 계산하지 않는다" });
        }
    }
    if (parts.stiffeners) {
        w.reads.push(...STIFFENER_READS);
        const ss = given(STIFFENER_ARGS);
        direct(a, w, STIFFENER_ARGS, used);
        if (a.transverse_stiffeners !== undefined) {
            used.add('transverse_stiffeners');
            put(w, 'merge', 'stiffenerMode', a.transverse_stiffeners === true ? 'present' : 'none', 'transverse_stiffeners');
        } else if (ss.length) { w.merge.stiffenerMode = 'present'; }
    }
    if (parts.torsion) {
        w.reads.push(...TORSION_READS);
        const da = given(TORSION_DIRECT_ARGS), ea = given(TORSION_ECCENTRIC_ARGS);
        direct(a, w, { ...TORSION_DIRECT_ARGS, ...TORSION_ECCENTRIC_ARGS }, used);
        if (da.length) { w.merge.torsionMode = 'direct'; } else if (ea.length) { w.merge.torsionMode = 'eccentric'; }
    }
}

/** 계약 §6.4: 「준 0 은 정말 0」 의 진술 → 검토 상태의 그 칸(화면 칸과 같은 키) — 받았을 때만(합치기) */
function zds(a: any, w: McpWrite, used: Set<string>): void {
    used.add('zero_demand_stated');
    if (a.zero_demand_stated !== undefined) { put(w, 'merge', 'designZeroDemandStated', a.zero_demand_stated === true, 'zero_demand_stated'); }
}

const memberFlexure: Mapper = (a, w, cur) => {
    const used = new Set<string>();
    zds(a, w, used);
    material(a, w, used);
    w.merge.memberType = 'flexure';
    w.reads.push(...MATERIAL_READS, ...FLEX_READS, 'designZeroDemandStated');
    direct(a, w, { Lb: 'Lb', Cb: 'Cb', Mu: 'Mux', Vu: 'Vu', Lb_pos: 'designLbPos', Cb_pos: 'designCbPos', Mu_pos: 'designMxPos',
        wc_P: 'wcP', wc_support: 'wcSupport', dist_M1_M2: 'distM1M2', dist_Lm: 'distLm', ...WC, ...USE }, used);
    if (a.dist_M1_M2 !== undefined || a.dist_Lm !== undefined) { w.merge.chkBetaDist = true; }
    if (a.R_uplift !== undefined) {
        used.add('R_uplift'); used.add('span_type');
        const opt = rOption(a.R_uplift, a.span_type);
        if (opt) { w.merge.chkRFactor = true; w.merge.rValue = opt; }
        else {
            w.skipped.push({ arg: 'R_uplift', reason: `R ${a.R_uplift} (${a.span_type ?? '경간 조건 없음'}) 은(는) 화면의 표 I6.2.1-1 선택지에 없다`, carried: true });
            w.mcpOnly.R_uplift = a.R_uplift;
            // 그 호출은 받은 R 로 — 화면의 R 선택지가 가진 경간 조건을 섞지 않는다
            if (a.span_type !== undefined) { w.mcpOnly.span_type = a.span_type; } else { w.unset.push('span_type'); }
        }
    }
    webArgs(a, w, used, cur, { holes: true, stiffeners: true, torsion: true });
    rest(a, w, used);
};

const memberCompression: Mapper = (a, w, cur) => {
    const used = new Set<string>();
    zds(a, w, used);
    material(a, w, used);
    w.merge.memberType = 'compression';
    w.reads.push(...MATERIAL_READS, ...COMP_READS, 'designZeroDemandStated');
    direct(a, w, { KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Pu: 'Pu' }, used);
    webArgs(a, w, used, cur, { holes: true });
    rest(a, w, used);
};

const memberCombined: Mapper = (a, w, cur) => {
    const used = new Set<string>();
    zds(a, w, used);
    material(a, w, used);
    w.merge.memberType = 'combined';
    // 조합의 휨 부분은 휨 설계를 그대로 부른다(엔진) — 화면 본문의 웹 크리플링 · 냉간가공 · β · 정모멘트 구간 칸도 계산에 든다
    w.reads.push(...MATERIAL_READS, ...COMP_READS, ...FLEX_READS.filter((k) => k !== 'Vu'), 'Cmx', 'Cmy', 'Muy', 'MayStrength', 'Vu', 'designZeroDemandStated');
    direct(a, w, { KxLx: 'KxLx', KyLy: 'KyLy', KtLt: 'KtLt', Lb: 'Lb', Cb: 'Cb', Cmx: 'Cmx', Cmy: 'Cmy', dist_M1_M2: 'distM1M2',
        Pu: 'Pu', Mux: 'Mux', Muy: 'Muy', May_strength: 'MayStrength', Vu: 'Vu' }, used);
    if (a.dist_M1_M2 !== undefined) { w.merge.chkBetaDist = true; }
    webArgs(a, w, used, cur, { holes: true, stiffeners: true, torsion: true });
    rest(a, w, used);
};

const memberTension: Mapper = (a, w) => {
    const used = new Set<string>();
    zds(a, w, used);
    material(a, w, used);
    w.merge.memberType = 'tension';
    w.reads.push(...MATERIAL_READS, 'Pu', 'designZeroDemandStated');
    direct(a, w, { Tu: 'Pu' }, used);   // 화면은 Pu 칸 하나를 인장 Tu 로도 쓴다
    rest(a, w, used);
};

const SPAN_OPTS = ['simple', 'cantilever', 'cont-2', 'cont-3', 'cont-4'];
const LOAD_BUNDLE: Record<string, string> = { D: 'loadD', Lr: 'loadLr', S: 'loadS', Wp: 'loadWp', L: 'loadL' };
const DECK_BUNDLE: Record<string, string> = { type: 'deckType', t_panel: 'deckTPanel', fastener_spacing: 'deckFastenerSpacing',
    kphi_override: 'deckKphiOverride', kx_override: 'deckKxOverride', R_tested_uplift: 'deckRTested' };
const LOAD_READS = ['spanType', 'nSpans', 'spacing', 'loadD', 'loadLr', 'loadS', 'loadWu', 'loadWp', 'loadL', 'chkPatternLoading',
    'chkLrReduced', 'spanIxIn4', ...Object.values(DECK_BUNDLE), 'bracePointsFt', 'chkI621Confirmed', 'deckInsulationIn', 'loadComboStandard'];

function loadsLike(withDesign: boolean): Mapper {
    return (a, w, cur, mctx) => {
        const used = new Set<string>();
        material(a, w, used);
        if (a.member_app !== undefined) { used.add('member_app'); put(w, 'merge', 'memberType', a.member_app, 'member_app'); }
        w.reads.push(...MATERIAL_READS, ...LOAD_READS);
        if (withDesign) { w.reads.push(...Object.values(WC), ...Object.values(USE), 'lapRestrained'); }
        w.reads.push('spans', 'supports', 'lapsPerSupport');
        // 경간 유형 · 수(받지 않으면 상태의 것 — 경간 표의 모양)
        const start = cur ? cur.inputs : DS.defaultInputs();
        let spanType = String(start.spanType ?? 'simple');
        let nSpans = Number(start.nSpans) || 0;
        if (typeof a.span_type === 'string') {
            used.add('span_type');
            const m = /^cont-(\d+)$/.exec(a.span_type);
            if (SPAN_OPTS.includes(a.span_type)) { w.merge.spanType = a.span_type; spanType = a.span_type; }
            else if (m) { w.merge.spanType = 'cont-n'; w.merge.nSpans = Number(m[1]); spanType = 'cont-n'; nSpans = Number(m[1]); }
            else if (a.span_type === 'cont-n' && Array.isArray(a.spans_ft) && a.spans_ft.length >= 1) {
                // 엔진의 cont-n = 경간 수는 spans_ft 의 길이 — 화면은 cont-n + 경간 수 칸
                w.merge.spanType = 'cont-n'; w.merge.nSpans = a.spans_ft.length; spanType = 'cont-n'; nSpans = a.spans_ft.length;
            }
            else { w.skipped.push({ arg: 'span_type', reason: a.span_type === 'cont-n' ? "'cont-n' 은 spans_ft 와 함께여야 한다(경간 수)" : `경간 유형 ${a.span_type} 은(는) 화면의 선택지가 아니다` }); }
        }
        if (a.spacing_ft !== undefined) { used.add('spacing_ft'); put(w, 'merge', 'spacing', a.spacing_ft, 'spacing_ft'); }
        // 하중: 엔진은 선하중(plf = psf × 간격) — 화면은 면압(psf). 간격은 받은 것, 없으면 화면의 것
        const spacing = num(a.spacing_ft) ?? num(start.spacing);
        if (a.loads && typeof a.loads === 'object') {
            used.add('loads');
            const L = a.loads;
            const extra: Record<string, unknown> = {};
            if (spacing && spacing > 0) {
                // 결정 D8: 묶음째로 — 준 묶음에서 빠진 성분은 화면의 값이 아니라 「주지 않음」(본문에서 0)
                for (const [k, key] of Object.entries(LOAD_BUNDLE)) {
                    const v = num(L[k]);
                    if (v === null) { w.group[key] = null; } else { put(w, 'group', key, perSpacing(v, spacing), `loads.${k}`); }
                }
                // 화면의 Wu 는 양력의 크기(본문 W = −Wu × 간격)
                if (num(L.W) === null) { w.group.loadWu = null; } else { put(w, 'group', 'loadWu', perSpacing(-(L.W as number), spacing), 'loads.W'); }
            } else {
                // 본문은 부재 간격이 비어 어차피 막힌다(그 칸을 말한다) — 여기서는 받은 묶음을 그대로 실어 둔다
                w.skipped.push({ arg: 'loads', reason: 'spacing_ft 가 없고 화면의 부재 간격도 비어 선하중(plf)을 화면의 면압(psf)으로 바꿀 수 없다', carried: true });
                Object.assign(extra, L);
            }
            for (const [k, v] of Object.entries(L)) { if (!['D', 'Lr', 'S', 'W', 'Wp', 'L'].includes(k)) { extra[k] = v; } }
            if (Object.keys(extra).length) { w.mcpOnly.loads = extra; }
        }
        direct(a, w, { pattern_loading: 'chkPatternLoading', lr_reduced: 'chkLrReduced', I_span_in4: 'spanIxIn4',
            brace_points_ft: 'bracePointsFt', i621_conditions_confirmed: 'chkI621Confirmed', insulation_in: 'deckInsulationIn',
            load_combination_standard: 'loadComboStandard' }, used);
        if (a.deck && typeof a.deck === 'object') {
            used.add('deck');
            const d = a.deck;
            const extra: Record<string, unknown> = {};
            // 결정 D8: 묶음째로 — 준 데크 묶음에서 빠진 화면 칸은 「주지 않음」
            for (const key of Object.values(DECK_BUNDLE)) { w.group[key] = null; }
            for (const [k, v] of Object.entries(d)) { if (DECK_BUNDLE[k]) { put(w, 'group', DECK_BUNDLE[k], v, `deck.${k}`); } else { extra[k] = v; } }
            if (Object.keys(extra).length) { w.mcpOnly.deck = extra; }
        }
        if (withDesign) {
            direct(a, w, { ...WC, ...USE }, used);
            // 계약 §6.3: lap_restrained(옛 이름 distortion_restrained 도) → 검토 상태의 lapRestrained
            if (a.lap_restrained !== undefined || a.distortion_restrained !== undefined) {
                used.add('lap_restrained'); used.add('distortion_restrained');
                put(w, 'merge', 'lapRestrained', (a.lap_restrained ?? a.distortion_restrained) === true, 'lap_restrained');
            }
            // 결정 T6 · T7: 구간 검토의 구멍 · 횡방향 웹 보강재(§H4 는 자동 계산 넷에 쓰지 않는다)
            webArgs(a, w, used, cur, { holes: true, stiffeners: true });
        }
        spanTable(a, w, used, spanType, nSpans);
        sectionArgs(a, w, used, cur, mctx, spanType, nSpans);
        rest(a, w, used);
    };
}

/** 결정 S1 의 MCP 단면 치수 이름(그 호출의 단위 — 서버가 US 로 바꾼 뒤) */
const SECTION_ARG_KEYS = ['H', 'B', 'D', 't', 'r', 'qlip'];
/**
 * 결정 S1 · S2: sections [{id?, name?, H, B, D, t, r, qlip}] (S1 = 지금 모델 — 목록에 넣지 않는다) 와 span_sections ['S1', 'S2', …] (경간마다 하나).
 * 둘 다 묶음째로 — 받은 sections 가 새 목록(id 를 주지 않은 단면은 S2 부터 비어 있는 번호), 받은 span_sections 가 경간의 단면 전부.
 * 경간 표를 묶음째 쓰면서 span_sections 를 주지 않으면 모든 경간 S1(그 표의 처음 값 — 경간별 Ix 와 같은 규칙). 모델이 템플릿 단면이 아니면 받지 않는다.
 */
function sectionArgs(a: any, w: McpWrite, used: Set<string>, cur: Cur, mctx: McpWriteContext | undefined, spanType: string, nSpans: number): void {
    w.reads.push('spanSections', 'sections');
    for (const k of ['sections', 'span_sections']) { if (a[k] !== undefined) { used.add(k); } }
    let list: SectionDef[] | undefined;
    if (a.sections !== undefined) {
        const tpl = mctx?.template ?? null;
        if (!tpl || !DS.SECTION_TEMPLATE_PARAMS[tpl]) {
            w.skipped.push({ arg: 'sections', reason: tpl
                ? `the current section template '${tpl}' cannot have a section list (only ${Object.keys(DS.SECTION_TEMPLATE_PARAMS).join(', ')})`
                : 'the current section is not a template section (hand-drawn / edited) — a section list needs a template section (set_section_template); every span uses S1' });
        } else if (!Array.isArray(a.sections)) {
            w.skipped.push({ arg: 'sections', reason: 'sections must be an array of {id?, name?, H, B, D, t, r, qlip}' });
        } else {
            const raw: any[] = a.sections;
            const keys: string[] = DS.SECTION_TEMPLATE_PARAMS[tpl];
            const out: any[] = [];
            const bad: string[] = [];
            for (const s of raw) {
                if (!s || typeof s !== 'object' || Array.isArray(s)) { bad.push('each section is an object'); continue; }
                const extra = Object.keys(s).filter((k) => !['id', 'name', ...SECTION_ARG_KEYS].includes(k));
                if (extra.length) { bad.push(`unknown section key(s) ${extra.join(', ')} (allowed: id, name, ${SECTION_ARG_KEYS.join(', ')})`); }
                const unused = SECTION_ARG_KEYS.filter((k) => s[k] !== undefined && !keys.includes(k));
                if (unused.length) { bad.push(`${unused.join(', ')} not used by the '${tpl}' template (it takes ${keys.join(', ')})`); }
                const params: Record<string, number | null> = {};
                for (const k of keys) { params[k] = s[k] === undefined ? null : s[k]; }
                out.push({ id: s.id, name: s.name ?? null, template: tpl, params });
            }
            // id 없는 단면: S2 부터 비어 있는 번호(받은 id 를 먼저 뺀다)
            for (const s of out) { if (s.id === undefined || s.id === null) { s.id = DS.nextSectionId(out.filter((x) => x.id)); } }
            // 검증 2026-11-28 의 2: 주지 않은 치수는 S1(모델의 템플릿 치수)의 값 — 채운 그대로 상태에 적고 답에 알린다. S1 에도 없으면 오류
            const fill = DS.fillSectionDims(out, mctx?.params ?? null);
            const errs = [...bad, ...fill.errors, ...DS.validateSections(fill.list)];
            if (errs.length) { w.skipped.push({ arg: 'sections', reason: errs.join(' · ') }); }
            else {
                list = fill.list.map((x: any) => DS.normalizeSection(x));
                w.sections = list;
                if (fill.filled.length) { w.sectionsFilled = fill.filled; }
            }
        }
    }
    // 검증 2026-11-28 의 4: 경간 표를 묶음째 쓰면서 span_sections 를 주지 않으면 모든 경간 S1(묶음의 규칙 — 그대로) — 단면 목록이 있으면 그렇게 했다고 알린다
    if (w.spans && a.span_sections === undefined && (list ?? cur?.sections ?? []).length > 0) { w.spanSectionsReset = true; }
    if (a.span_sections !== undefined) {
        const ids = DS.sectionIds(list ?? cur?.sections ?? []);
        const n = w.spans ? w.spans.spans.length : (cur ? cur.spans.spans.length : DS.spanCount(spanType, nSpans));
        const v = a.span_sections;
        const errs = !Array.isArray(v) ? ['span_sections must be an array of section ids, one per span']
            : DS.validateSpanTable({ spans: Array.from({ length: n }, () => 0), supports: Array.from({ length: n + 1 }, () => 'P'),
                lapsPerSupport: Array.from({ length: n + 1 }, () => ({ left: null, right: null })), spanSections: v }, 'cont-n', n, ids);
        if (errs.length) { w.skipped.push({ arg: 'span_sections', reason: errs.join(' · ') }); }
        else if (w.spans) { w.spans = { ...w.spans, spanSections: [...v] }; }
        else { w.spanSections = [...v]; }
    }
}

/**
 * 경간 표 — 묶음째로(결정 D8 · 「지금처럼 주었을 때만」): 경간 · 지점 · 랩의 인자 가운데 하나라도 받으면 표 전체를 쓴다 — 그 경간 유형의
 * 처음 표(지점 모두 P · 캔틸레버 F N, 랩 0)에 받은 부분을 얹는다. spans_ft(또는 span_ft 를 모든 경간에) → 경간, supports → 지점,
 * laps_per_support(또는 laps 를 모든 안쪽 지점에) → 지점별 랩. 받지 않은 부분에 화면의 지점 · 랩을 섞지 않는다(엔진의 「supports 를
 * 주지 않으면 모두 핀」 과 같은 뜻 — 하중의 Lr 을 섞지 않는 것과 같은 까닭). 하나도 받지 않으면 화면의 표 그대로.
 */
function spanTable(a: any, w: McpWrite, used: Set<string>, spanType: string, nSpans: number): void {
    const hasSpans = Array.isArray(a.spans_ft) || num(a.span_ft) !== null;
    const hasSupports = Array.isArray(a.supports);
    const hasLaps = Array.isArray(a.laps_per_support) || (!!a.laps && typeof a.laps === 'object' && !Array.isArray(a.laps));
    for (const k of ['spans_ft', 'span_ft', 'supports', 'laps_per_support', 'laps']) { if (a[k] !== undefined) { used.add(k); } }
    if (!hasSpans && !hasSupports && !hasLaps) { return; }
    const fresh: SpanTable = DS.defaultSpanTable(spanType, nSpans);
    const table: SpanTable = clone(fresh);
    if (Array.isArray(a.spans_ft)) { table.spans = a.spans_ft.map((v: unknown) => num(v)); }
    else if (num(a.span_ft) !== null) { table.spans = table.spans.map(() => a.span_ft); }
    if (hasSupports) { table.supports = [...a.supports]; }
    if (Array.isArray(a.laps_per_support)) {
        table.lapsPerSupport = fresh.lapsPerSupport.map((cell: { left: number | null; right: number | null }, i: number) => {
            const l = a.laps_per_support[i] || {};
            return { left: cell.left === null ? null : (num(l.left_ft) ?? 0), right: cell.right === null ? null : (num(l.right_ft) ?? 0) };
        });
    } else if (hasLaps) {
        // 엔진의 laps: 모든 안쪽 지점에 같은 랩(끝 지점에는 랩이 없다)
        const n = fresh.lapsPerSupport.length - 1;
        table.lapsPerSupport = fresh.lapsPerSupport.map((cell: { left: number | null; right: number | null }, i: number) => {
            const inner = i > 0 && i < n;
            return { left: cell.left === null ? null : (inner ? (num(a.laps.left_ft) ?? 0) : 0), right: cell.right === null ? null : (inner ? (num(a.laps.right_ft) ?? 0) : 0) };
        });
    }
    const errs = DS.validateSpanTable(table, spanType, nSpans);
    if (errs.length) { w.skipped.push({ arg: 'spans_ft / span_ft / supports / laps_per_support / laps', reason: errs.join(' · ') }); return; }
    w.spans = table;
    // 경간별 Ix 는 경간마다 한 값 — 경간 표의 것이다. 표를 묶음째 쓸 때 함께 주지 않았으면 「주지 않음」(앞 사례의 목록이 남으면
    // 개수가 경간 수와 달라 본문이 막힌다 — 6경간의 목록이 남은 채 단순보를 부르던 다리 시험 s14d)
    if (a.I_span_in4 === undefined) { w.group.spanIxIn4 = null; }
}

/** 한 ulp 옆의 수(0 이 아닌 유한한 수) */
function ulpStep(x: number, dir: 1 | -1): number {
    const f = new Float64Array([x]);
    const u = new BigInt64Array(f.buffer);
    u[0] += BigInt(dir * (x >= 0 ? 1 : -1));
    return f[0];
}
/**
 * 선하중(plf) → 화면의 면압(psf) = plf ÷ 간격. 화면 단추의 본문이 다시 곱하면(psf × 간격) 받은 plf 가 그대로 나오는 값을 고른다(있으면) —
 * 15 plf ÷ 3.28 ft × 3.28 ft 가 14.999999999999998 이 되어 AI 가 준 하중과 다른 수가 엔진에 가지 않게.
 */
function perSpacing(plf: number, spacing: number): number {
    const q = plf / spacing;
    if (q * spacing === plf || q === 0 || !isFinite(q)) { return q; }
    for (const c of [Number(q.toPrecision(15)), Number(q.toPrecision(14)), Number(q.toPrecision(13)), ulpStep(q, 1), ulpStep(q, -1)]) {
        if (c * spacing === plf) { return c; }
    }
    return q;
}

const CONNECTION_FIELDS: Record<string, string> = { connection_type: 'connSingleType', t1: 'connT1', t2: 'connT2', d: 'connD', n: 'connN',
    Fy: 'connFy', Fu: 'connFu', Pu: 'connPu', Tu: 'connTu', e: 'connE', s: 'connS', width: 'connWidth', member_case: 'connMemberCase',
    j6_3_not_applicable: 'connJ63NotApplicable', dw: 'connDw', Pnvs: 'connPnvs', weld_length: 'connWeldL', weld_size: 'connWeldSize',
    groove_type: 'connGrooveType', Fub: 'connFub', Fuf: 'connFuf' };

const connection: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used, {});   // 접합의 Fy · Fu 는 접합 칸(connFy · connFu) — 아래
    w.reads.push('designMethod', ...Object.values(CONNECTION_FIELDS));
    direct(a, w, CONNECTION_FIELDS, used);
    rest(a, w, used);
};

const lap: Mapper = (a, w) => {
    const used = new Set<string>();
    material(a, w, used);
    const t: Record<string, string> = { lap_left_in: 'connLapLeft', lap_right_in: 'connLapRight', Mu_support: 'connMu', Vu_support: 'connVu',
        fastener_type: 'connFastenerType', fastener_dia: 'connFastenerDia', n_rows: 'connNRows', end_distance: 'connEdgeDist', Pnvs: 'connLapPnvs' };
    w.reads.push(...MATERIAL_READS, ...Object.values(t), 'lapRestrained', 'connZeroDemandStated', 'connLapSupport', 'lapForceModelConfirmed');
    direct(a, w, t, used);
    // 계약 §6.3: 0 은 밝혔을 때만 — 그 진술도 검토 상태에(화면의 칸과 같은 키)
    if (a.zero_demand_stated !== undefined) { used.add('zero_demand_stated'); put(w, 'merge', 'connZeroDemandStated', a.zero_demand_stated === true, 'zero_demand_stated'); }
    // 결정 R2: 패스너 힘 분배(모든 패스너가 고르게)로 판정한다는 사람의 진술 — 검토 상태의 그 칸(화면 칸과 같은 키)
    if (a.lap_force_model_confirmed !== undefined) { used.add('lap_force_model_confirmed'); put(w, 'merge', 'lapForceModelConfirmed', a.lap_force_model_confirmed === true, 'lap_force_model_confirmed'); }
    // 계약 §6.3: 랩 구속의 진술(옛 이름 distortion_restrained) — 퍼린과 같은 검토 상태 키
    if (a.lap_restrained !== undefined || a.distortion_restrained !== undefined) {
        used.add('lap_restrained'); used.add('distortion_restrained');
        put(w, 'merge', 'lapRestrained', (a.lap_restrained ?? a.distortion_restrained) === true, 'lap_restrained');
    }
    // 단면 치수(d · t)는 모델 칸 — 상태에 쓰지 않고(mcpOnly) 그 호출의 본문은 받은 값으로(모델에 템플릿 치수가 없어도 막히지 않게)
    if (num(a.d) !== null) { w.drafts.tplH = a.d; }
    if (num(a.t) !== null) { w.drafts.tplT = a.t; }
    rest(a, w, used);   // d · t · Se · Sf · Mnd · Vn … 은 mcpOnly
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

/** MCP 도구의 인자(US) → 상태에 합칠 것. cur = 지금 상태(경간 표의 바탕 · 하중 환산의 간격) */
export function mcpWrite(action: string, options: any, cur?: Cur, mctx?: McpWriteContext): McpWrite | null {
    const g = mcpGroupFor(action, options);
    if (!g) { return null; }
    const w: McpWrite = { tool: g.tool, group: {}, merge: {}, mcpOnly: {}, context: {}, unset: [], drafts: {}, reads: [], skipped: [] };
    g.map(options || {}, w, cur, mctx);
    w.reads = [...new Set(w.reads)];
    return w;
}

/** 이 호출에 받은 검토 상태의 칸(합치기 · 묶음 · 경간 표의 받은 부분) */
export function givenKeys(w: McpWrite): Set<string> {
    return new Set([...Object.keys(w.merge), ...Object.keys(w.group), ...Object.keys(w.spans || {}),
        ...(w.sections !== undefined ? ['sections'] : []), ...(w.spanSections !== undefined ? ['spanSections'] : [])]);
}

/** 합친 상태로 만든 화면 단추의 본문 → 그 호출의 엔진 본문: 화면 칸이 없는 인자 · 위치 · 조합 꼬리표를 얹는다 */
export function mcpBody(data: Record<string, unknown>, w: McpWrite): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const k of w.unset) { delete out[k]; }
    const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
    for (const [k, v] of Object.entries(w.mcpOnly)) {
        // 하중 · 데크 묶음의 화면 칸이 없는 성분(R · Fss_kip …)은 묶음 안에 — 화면 칸의 성분은 상태(= 이번에 준 묶음)에서 왔다
        out[k] = (k === 'loads' || k === 'deck') && isObj(v) && isObj(out[k]) ? { ...(out[k] as object), ...(v as object) } : v;
    }
    for (const [k, v] of Object.entries(w.context)) { out[k] = v; }
    return out;
}

/** 화면 칸이 없어 화면 단추로는 다시 나오지 않는 인자의 이름(묶음 안의 것은 loads.R 꼴) */
export function argsNotOnScreen(w: McpWrite): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(w.mcpOnly)) {
        if ((k === 'loads' || k === 'deck') && v && typeof v === 'object' && !Array.isArray(v)) { out.push(...Object.keys(v).map((x) => `${k}.${x}`)); }
        else { out.push(k); }
    }
    return out;
}

/** 화면 단추의 본문이 그 값이면 보내지 않는 칸(requests.ts — _optPos 의 0 이하, 켰을 때만 싣는 진술, 「자동」 선택) */
const POSITIVE_ONLY = new Set(['wcLo', 'wcEdgeDistance', 'wcFastenerSpacing']);
const TRUE_ONLY = new Set(['designZeroDemandStated', 'connZeroDemandStated', 'chkRFactor', 'lapRestrained', 'chkI621Confirmed', 'connJ63NotApplicable',
    'lapForceModelConfirmed', 'holeEdgeStiffened', 'holeWithinBearing', 'torsionAtJunction']);
function notSent(k: string, v: unknown): boolean {
    if (POSITIVE_ONLY.has(k)) { return !(typeof v === 'number' && v > 0); }
    if (TRUE_ONLY.has(k)) { return v !== true; }
    if (k === 'loadComboStandard') { return v === 'asce7_10'; }
    // 결정 T7: 「없음」 인 구역의 고르기
    if (k === 'holeShape' || k === 'stiffenerMode' || k === 'torsionMode') { return v === 'none'; }
    return k === 'wcFamily' && v === 'auto';
}
/** 결정 T7: 그 구역이 「없음」 이거나 고른 길이 아니라 본문에 가지 않는 칸(case_inputs_used 에서 뺀다 — 본문의 규칙은 designState.memberWebOptions) */
function webFieldIdle(k: string, inp: Record<string, InputValue>): boolean {
    const g = DS.fieldMeta(k)?.group;
    if (g === 'holes') {
        if (k === 'holeShape') { return false; }
        // 원형은 Lh = dh · 모서리 반지름 없음(본문에 가지 않는다)
        if (inp.holeShape === 'circular') { return k === 'holeLength' || k === 'holeCornerRadius'; }
        return inp.holeShape !== 'noncircular';
    }
    if (g === 'stiffeners') { return k !== 'stiffenerMode' && inp.stiffenerMode !== 'present'; }
    if (g === 'torsion') {
        if (k === 'torsionMode') { return false; }
        if (Object.values(TORSION_DIRECT_ARGS).includes(k)) { return inp.torsionMode !== 'direct'; }
        return inp.torsionMode !== 'eccentric';
    }
    return false;
}

/**
 * 결정 D1: AI 가 주지 않아 상태에서 온 값 — 그 도구의 본문이 읽는 칸 가운데 이번에 받지 않았고 비어 있지 않은 것({key, value, source}).
 * 본문에 들지 않는 것은 뺀다(R 선택지는 체크했을 때만, β 의 M1/M2 · Lm 은 β 를 켰을 때만, 접합은 그 형식이 쓰는 칸만, notSent).
 */
export function inputsUsed(w: McpWrite, st: CaseState): { key: string; value: unknown; source: string }[] {
    const given = givenKeys(w);
    const inp = st.inputs;
    const ct = String(inp.connSingleType || 'screw');
    const connSkip: Record<string, boolean> = {
        connDw: !['screw', 'paf', 'bolt'].includes(ct), connPnvs: ct !== 'screw',
        connWeldL: !['fillet_weld', 'arc_spot', 'arc_seam', 'groove'].includes(ct), connWeldSize: !['fillet_weld', 'arc_spot', 'arc_seam', 'groove'].includes(ct),
        connGrooveType: ct !== 'groove', connFub: !['bolt', 'screw'].includes(ct), connFuf: ct !== 'paf',
    };
    const out: { key: string; value: unknown; source: string }[] = [];
    for (const k of w.reads) {
        if (given.has(k)) { continue; }
        if (k === 'rValue' && inp.chkRFactor !== true) { continue; }
        if ((k === 'distM1M2' || k === 'distLm') && inp.chkBetaDist !== true) { continue; }
        if ((w.tool === 'design_connection' || w.tool === 'aisi_design_connection') && connSkip[k]) { continue; }
        if (webFieldIdle(k, inp)) { continue; }
        // 압축의 구멍은 §E 의 키만(§G3 · §G6 의 칸은 본문에 가지 않는다)
        if (w.tool === 'aisi_design_compression' && ['holeEndDistance', 'holeCornerRadius', 'holeBearingDistance', 'holeWithinBearing'].includes(k)) { continue; }
        const span = k === 'spans' || k === 'supports' || k === 'lapsPerSupport' || k === 'spanSections';
        const v = k === 'sections' ? st.sections : span ? (st.spans as any)[k] : inp[k];
        if (v === null || v === undefined || v === '' || notSent(k, v)) { continue; }
        // 결정 S1: 모든 경간 S1 · 빈 단면 목록은 본문에 가지 않는다
        if ((k === 'spanSections' || k === 'sections') && DS.sectionsAreDefault(st.spans.spanSections, st.sections)) { continue; }
        out.push({ key: k, value: clone(v), source: st.sources[k] ?? 'default' });
    }
    return out;
}
