/**
 * K2 — 검토 상태로 호스트 → 엔진 요청 본문을 만든다. 순수 모듈(vscode · 파일 없음).
 *
 * 지금 화면(webview/js/app.js)의 본문 조립을 **바이트까지 같게** 옮긴 것이다 — collectDesignRunPayload · collectLoadAnalysisPayload ·
 * 랩 단추 · 단일 접합 단추. 키의 차례, 보내지 않는 키(undefined), 빈 칸의 규칙(reqNum → 막음, zeroNum → 0, _optNum → 보내지 않음,
 * _optPos → 0 이하도 보내지 않음), 선택 칸의 대체(`|| 'EOF'` 같은 것)를 그대로 지킨다(설계 §4.3). 고정값
 * test/rendered/k2/golden/gui-*.json 의 엔진 요청이 그 잣대다.
 *
 * 화면의 칸 가운데 모델이 주인인 것(템플릿 · 치수 — 「생성」 전에 사람이 친 초안일 수 있다)은 ctx.drafts 에서 읽는다(화면이 caseEdit 의
 * drafts 로 알린 값, 화면이 없으면 모델에서 만든 값 — modelDrafts()).
 */
import { CaseState, InputValue } from './caseState';

const DS = require('../../webview/js/designState');
const UTILS = require('../../webview/js/utils');

export interface RequestContext {
    /** 모델 칸(templateType · tplH · tplB · tplD · tplT · tplR …)의 화면 값(US) */
    drafts: Record<string, InputValue>;
    /** 지금 단면 성질(화면의 lastProps — 호스트가 마지막으로 보낸 propertiesResult) */
    props: { Ixx?: number; Sx?: number } | null;
    /** 화면의 _lastDesignResult — 직접 설계 결과 그대로, 퍼린이면 지배 구간(pickGoverningPurlinDesign) */
    lastDesign: any;
    /** V8-01: 퍼린 결과 묶음 그대로(regions[] — 랩 검토의 단면 강도를 그 지점의 랩 구간에서). 퍼린이 아니면 null */
    purlin?: any;
}

export interface BuiltRequest {
    /** 엔진 본문(화면이 보냈을 것과 같은 키 · 차례). missing 이 있으면 화면은 보내지 않는다 */
    data?: any;
    /** 비어서 막힌 필수 칸 — 화면 이름(화면의 reqNum 라벨) */
    missing: string[];
    /** 그 칸의 키(검토 상태 · 모델 칸 — MCP 의 오류가 set_case_inputs 의 키로 말한다). missing 과 같은 차례 */
    missingKeys?: string[];
    /** 하중 본문의 형식 오류(브레이스 · 경간별 Ix) — 화면의 그 문장 */
    error?: string;
}

const CALC_MODES = ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'];
export const isCalcMode = (t: unknown): boolean => CALC_MODES.includes(String(t));

class Reader {
    missing: string[] = [];
    missingKeys: string[] = [];
    constructor(private readonly st: CaseState, private readonly drafts: Record<string, InputValue>) {}
    raw(key: string): InputValue | undefined {
        const m = DS.fieldMeta(key);
        if (m && m.owner === 'model') { return this.drafts[key]; }
        if (m && m.owner === 'mirror') { return this.st.inputs[m.mirrorOf]; }
        return this.st.inputs[key];
    }
    /** reqNum: 비면 막는다 */
    req(key: string, label: string): number {
        const v = this.raw(key);
        if (typeof v !== 'number' || !isFinite(v)) { this.missing.push(label); this.missingKeys.push(key); return NaN; }
        return v;
    }
    /** zeroNum: 빈 칸 = 0 */
    zero(key: string): number {
        const v = this.raw(key);
        return typeof v === 'number' && isFinite(v) ? v : 0;
    }
    /** _optNum: 비면 보내지 않는다 */
    opt(key: string): number | undefined {
        const v = this.raw(key);
        return typeof v === 'number' && isFinite(v) ? v : undefined;
    }
    /** _optPos: 비었거나 0 이하이면 보내지 않는다 */
    pos(key: string): number | undefined {
        const v = this.opt(key);
        return v !== undefined && v > 0 ? v : undefined;
    }
    sel(key: string, fallback: string): string {
        const v = this.raw(key);
        return typeof v === 'string' && v !== '' ? v : fallback;
    }
    chk(key: string): boolean { return this.raw(key) === true; }
}

/** 직접 입력 설계(runDesign → aisi_design) — app.js collectDesignRunPayload 그대로 */
export function buildDesignRequest(st: CaseState, ctx: RequestContext): BuiltRequest {
    const r = new Reader(st, ctx.drafts);
    const rawMemberType = r.sel('memberType', 'compression');
    const memberType = isCalcMode(rawMemberType) ? 'flexure' : rawMemberType;
    const beta = r.chk('chkBetaDist');
    const data: any = {
        member_type: memberType,
        design_method: r.sel('designMethod', 'LRFD'),
        Fy: r.req('fy', '설계 Fy'),
        Fu: r.opt('fu'),
        KxLx: r.opt('KxLx'), KyLy: r.opt('KyLy'), KtLt: r.opt('KtLt'),
        Lb: r.opt('Lb'), Cb: r.opt('Cb'),
        Lb_pos: r.opt('designLbPos'), Cb_pos: r.opt('designCbPos'),
        Cmx: r.opt('Cmx'), Cmy: r.opt('Cmy'),
        // 계약 §6.4: 비운 소요는 보내지 않는다(0 으로 채우지 않는다 — 「밝히지 않은 0」 이 된다)
        Pu: r.opt('Pu'),
        Mu: r.opt('Mux'),
        Mu_pos: r.opt('designMxPos'),
        Mux: r.opt('Mux'),
        Muy: r.opt('Muy'),
        May_strength: r.opt('MayStrength'),
        Vu: r.opt('Vu'),
        Tu: r.opt('Pu'),
        wc_N: r.opt('wcN'),
        wc_P: r.opt('wcP'),
        wc_R: r.opt('wcR'),
        wc_support: r.sel('wcSupport', 'EOF'),
        wc_fastened: r.sel('wcFastened', 'fastened'),
        wc_web_config: r.sel('wcWebConfig', 'single'),
        wc_section_family: (() => { const v = r.sel('wcFamily', 'auto'); return v === 'auto' ? undefined : v; })(),
        wc_flange_condition: r.sel('wcFlangeCondition', 'stiffened'),
        wc_overhang: r.pos('wcLo'),
        wc_edge_distance: r.pos('wcEdgeDistance'),
        wc_n_webs: r.opt('wcNWebs'),
        wc_support_fastener_spacing: r.pos('wcFastenerSpacing'),
        use_inelastic_reserve: r.chk('chkInelasticReserve'),
        use_cold_work: r.chk('chkColdWork'),
        dist_M1_M2: beta ? r.opt('distM1M2') : undefined,
        dist_Lm: beta ? r.opt('distLm') : undefined,
        R: r.opt('tplR'),
        t: r.opt('tplT'),
        ...rFactor(st),
    };
    // 계약 §6.4: 「준 0 인 주 소요는 정말 0」 — 사람이 칸으로 밝혔을 때만
    if (r.chk('designZeroDemandStated')) { data.zero_demand_stated = true; }
    // 2026-11-26 결정 T7: 웹 구멍 · 횡방향 웹 보강재 · §H4 — 「없음」 이 아닌 구역의 엔진 키만(화면과 같은 함수, 처음 값의 본문은 그대로).
    // 자동 계산 넷은 구간 검토에 구멍 · 보강재만(buildPurlinRequest 가 옮긴다 — 결정 T6). 단면 모델(node · elem · element_roles …)은
    // 호스트가 엔진에 보내기 직전에 붙인다(StcfsdPanel._designMember · _designPurlin — 모델은 검토 상태가 아니다)
    const web = DS.memberWebOptions((k: string) => r.raw(k), isCalcMode(rawMemberType) ? 'purlin' : memberType);
    Object.assign(data, web.data);
    for (const m of web.missing) { r.missing.push(m.label); r.missingKeys.push(m.key); }
    // 칸의 규칙에 맞지 않는 값(0 이하 · 음수 — 상태는 받지 않으므로 옛 파일 · 초안에서만): 보내지 않고 막는다(빈 필수 칸과 같은 길, 까닭을 이름에)
    for (const m of web.invalid || []) { r.missing.push(`${m.label} (${DS.webOptionRuleText(m.rule)})`); r.missingKeys.push(m.key); }
    return { data, missing: r.missing, missingKeys: r.missingKeys };
}

/** 결정 T7 · T6: 자동 계산 넷의 구간 검토에 옮기는 구멍 · 보강재 키(memberWebOptions 의 'purlin' 범위) */
export const isWebOptionKey = (k: string): boolean => k.startsWith('hole_') || k.startsWith('stiffener_') || k === 'transverse_stiffeners';

/** §I6.2.1 R: 체크하고 값을 골랐을 때만, 고른 선택지의 경간 조건과 함께(F4 V2-03) — 선택지의 정체는 표의 optSpan */
function rFactor(st: CaseState): Record<string, unknown> {
    if (st.inputs.chkRFactor !== true) { return {}; }
    const v = typeof st.inputs.rValue === 'string' ? st.inputs.rValue : '0';
    const R = parseFloat(v || '0');
    if (!(R > 0)) { return {}; }
    const m = DS.fieldMeta('rValue');
    const i = (m.opts as string[]).indexOf(v);
    const span = i >= 0 && m.optSpan ? m.optSpan[i] : null;
    return span ? { R_uplift: R, span_type: span } : { R_uplift: R };
}

/**
 * 하중 해석 본문의 선택(MCP 의 길만 — 화면 단추는 쓰지 않는다): sectionOptional = 템플릿 치수 칸이 비어도(모델이 템플릿이 아닌 단면) 막지
 * 않는다 — 단면 정보를 보내지 않고(호스트가 지금 모델에서 만든다, _analyzeLoads) 재료 Fy · Fu 를 위에 둔다. 지금까지 MCP 하중 해석이 되던 단면이
 * 새 규칙(화면 단추와 같은 본문)에서 막히지 않게.
 */
export interface LoadRequestOptions { sectionOptional?: boolean }

/** 하중 분석(analyzeLoads → analyze_loads) — app.js collectLoadAnalysisPayload 그대로. 자동 계산 모드가 아니면 data 없음 */
export function buildLoadRequest(st: CaseState, ctx: RequestContext, opts: LoadRequestOptions = {}): BuiltRequest {
    const r = new Reader(st, ctx.drafts);
    const memberApp = r.sel('memberType', '');
    if (!isCalcMode(memberApp)) { return { missing: [] }; }
    const spacingUS = r.req('spacing', '부재 간격');
    let spanType = r.sel('spanType', 'simple');
    if (spanType === 'cont-n') {
        const n = r.req('nSpans', '경간 수');
        spanType = 'cont-' + n;
    }
    const secType = r.raw('templateType');
    const normalizedSectionType = loadSectionType(secType);
    const isHat = normalizedSectionType === 'Hat';
    const hasLip = ['C', 'Z', 'LippedAngle'].includes(normalizedSectionType);
    // sectionOptional: 치수 칸은 따로 읽어 막지 않는다(빈 칸이면 아래에서 단면 정보를 보내지 않는다)
    const rs = opts.sectionOptional ? new Reader(st, ctx.drafts) : r;
    // 읽는 차례(빈 칸의 이름 차례)는 전과 같다 — 깊이 · 폭 · t · 립 · r · Fy · Fu. 꼴은 결정 S1 의 경간 단면과 한 함수(loadSectionDict)
    const depthV = rs.req(isHat ? 'tplB' : 'tplH', isHat ? '단면 B(깊이)' : '단면 H');
    const widthV = rs.req(isHat ? 'tplH' : 'tplB', isHat ? '단면 H(상판 폭)' : '단면 B');
    const tV = rs.req('tplT', '단면 t');
    const lipV = hasLip ? rs.req('tplD', '립 D') : 0;
    const rV = r.opt('tplR');
    const sectionInfo: any = loadSectionDict(normalizedSectionType, depthV, widthV, tV, lipV, rV,
        r.req('fy', '설계 Fy'), r.opt('fu'), ctx.props ? ctx.props.Ixx : undefined);
    const spanLens: number[] = [];
    st.spans.spans.forEach((v, i) => {
        if (typeof v !== 'number' || !isFinite(v)) { r.missing.push('경간 ' + (i + 1) + ' 길이'); r.missingKeys.push('spans'); spanLens.push(NaN); return; }
        spanLens.push(v);
    });
    const supports = [...st.spans.supports];
    const lapsPerSupport = supports.map((_s, i) => {
        const l = st.spans.lapsPerSupport[i] || { left: null, right: null };
        return { left_ft: typeof l.left === 'number' ? l.left || 0 : 0, right_ft: typeof l.right === 'number' ? l.right || 0 : 0 };
    });
    const allSame = spanLens.every((v) => Math.abs(v - spanLens[0]) < 0.01);
    const spanFt = allSame ? spanLens[0] : Math.max(...spanLens);
    const interiorLaps = lapsPerSupport.slice(1, Math.max(1, supports.length - 1));
    const maxLapLeft = interiorLaps.length > 0 ? Math.max(...interiorLaps.map((lp) => lp.left_ft || 0)) : 0;
    const maxLapRight = interiorLaps.length > 0 ? Math.max(...interiorLaps.map((lp) => lp.right_ft || 0)) : 0;
    const D = r.zero('loadD'), Lr = r.zero('loadLr'), S = r.zero('loadS'), Wu = r.zero('loadWu'), Wp = r.zero('loadWp'), L = r.zero('loadL');
    if (r.missing.length > 0) { return { missing: r.missing, missingKeys: r.missingKeys }; }
    const opt = (k: string): number | undefined => r.opt(k);
    const data: any = {
        member_app: memberApp,
        span_type: spanType,
        span_ft: spanFt,
        spans_ft: spanLens,
        supports,
        laps_per_support: lapsPerSupport,
        spacing_ft: spacingUS,
        loads: { D: D * spacingUS, Lr: Lr * spacingUS, S: S * spacingUS, W: -(Wu * spacingUS), Wp: Wp * spacingUS, L: L * spacingUS },
        design_method: r.sel('designMethod', 'LRFD'),
        laps: { left_ft: maxLapLeft, right_ft: maxLapRight },
        deck: {
            type: r.sel('deckType', 'none'),
            t_panel: opt('deckTPanel'),
            fastener_spacing: opt('deckFastenerSpacing'),
            kphi_override: opt('deckKphiOverride'),
            kx_override: opt('deckKxOverride'),
        },
        section: (sectionInfo.depth > 0 && sectionInfo.thickness > 0) ? sectionInfo : undefined,
        pattern_loading: r.chk('chkPatternLoading'),
        lr_reduced: r.chk('chkLrReduced'),
    };
    if (r.chk('chkI621Confirmed')) { data.i621_conditions_confirmed = true; }
    // 결정 R4: 하중조합의 기준 — 처음 값(asce7_10)이 아닐 때만(처음 값의 본문은 바이트까지 그대로)
    const lcs = r.sel('loadComboStandard', 'asce7_10');
    if (lcs !== 'asce7_10') { data.load_combination_standard = lcs; }
    const ins = opt('deckInsulationIn');
    if (ins !== undefined) { data.insulation_in = ins; }
    const rt = opt('deckRTested');
    if (rt !== undefined) { data.deck.R_tested_uplift = rt; }
    const braces = st.inputs.bracePointsFt;
    if (Array.isArray(braces) && braces.length) { data.brace_points_ft = [...braces]; }
    const ixs = st.inputs.spanIxIn4;
    if (Array.isArray(ixs) && ixs.length) {
        if (ixs.length !== spanLens.length) {
            return { missing: [], error: '「경간별 Ix」(② 하중계산 탭) 개수(' + ixs.length + ')가 경간 수(' + spanLens.length + ')와 다릅니다.' };
        }
        data.I_span_in4 = [...ixs];
    }
    // 2026-11-28 결정 S1 · S2: 경간마다 단면 — S1 이 아닌 경간이 있을 때만(모든 경간 S1 이면 본문은 이 기능이 없던 때와 바이트까지 같다).
    // 본문은 단면의 id 와 치수(호스트가 _analyzeLoads 에서 단면마다 엔진의 단면(Ixx 포함)으로 바꾼다 — 화면은 S2 의 Ixx 를 모른다)
    const ss = spanSectionsBody(st, ctx);
    if (ss.error) { return { missing: [], error: ss.error }; }
    if (ss.missing.length) { return { missing: ss.missing, missingKeys: ss.missing.map(() => 'sections') }; }
    if (ss.data) { data.span_sections = ss.data.span_sections; data.sections = ss.data.sections; }
    // sectionOptional 에서 단면 정보를 보내지 않으면 호스트가 모델에서 만드는 단면에 쓸 재료 값(MCP analyze_loads 의 Fy · Fu 인자와 같은 자리)
    if (opts.sectionOptional && data.section === undefined) {
        data.Fy = sectionInfo.Fy;
        if (sectionInfo.Fu !== undefined) { data.Fu = sectionInfo.Fu; }
    }
    return { data, missing: [] };
}

/** 템플릿 이름 → 하중 해석 단면의 type(app.js collectLoadAnalysisPayload 와 같은 표) */
export function loadSectionType(templateType: unknown): string {
    const t = String(templateType || '').toLowerCase();
    const table: Record<string, string> = { lippedc: 'C', lippedz: 'Z', track: 'Track', hat: 'Hat', rhs: 'RHS', chs: 'CHS',
        isect: 'I', tee: 'Tee', angle: 'Angle', lipped_angle: 'LippedAngle' };
    return table[t] || 'custom';
}

/**
 * 하중 해석의 단면 한 벌(analyze_loads 의 section · span_sections[i] 의 꼴) — 키 차례가 엔진 본문의 차례다. 결정 S1: 모델(S1)의 단면과
 * 단면 목록의 단면(S2 …)이 이 한 함수로 만든다(같은 치수면 같은 단면 — 엔진의 같은 단면 판단 · 데크 강성이 같다).
 */
export function loadSectionDict(type: string, depth: number, flangeWidth: number, thickness: number, lipDepth: number,
    rCorner: number | undefined, Fy: number, Fu: number | undefined, Ixx: number | undefined): any {
    return { depth, flange_width: flangeWidth, thickness, lip_depth: lipDepth, R_corner: rCorner, type, Fy, Fu, Ixx };
}

/** 결정 S1: 템플릿 치수(H · B · D · t · r — 템플릿 칸의 뜻) → 하중 해석의 단면(loadSectionDict). hat 은 H = 상판 폭 · B = 깊이 */
export function loadSectionFromParams(templateType: string, p: Record<string, number | null | undefined>, Fy: number, Fu: number | undefined, Ixx: number | undefined): any {
    const type = loadSectionType(templateType);
    const isHat = type === 'Hat';
    const hasLip = ['C', 'Z', 'LippedAngle'].includes(type);
    const n = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
    return loadSectionDict(type, (isHat ? n(p.B) : n(p.H)) as number, (isHat ? n(p.H) : n(p.B)) as number, n(p.t) as number,
        hasLip ? (n(p.D) as number) : 0, n(p.r), Fy, Fu, Ixx);
}

/** 결정 S1 · S2: 단면 목록이 쓸 수 있는 템플릿인가(모델 · 초안의 템플릿 종류) */
export function sectionListTemplate(templateType: unknown): string | null {
    const t = typeof templateType === 'string' ? templateType : '';
    return t && DS.SECTION_TEMPLATE_PARAMS[t] ? t : null;
}

/**
 * 결정 S1 · S2: 하중 해석 · 퍼린 본문의 span_sections(경간마다 id) · sections(쓰는 단면 S2 … 의 id · 이름 · 템플릿 · 치수 — 빈 치수는 빼고).
 * 모든 경간이 S1 이면 data 없음. 막는 것: 템플릿 단면이 아닌 모델(초안의 템플릿이 없다 · 목록에 쓸 수 없는 종류), 템플릿이 다른 단면,
 * 목록에 없는 id, 빈 H · B · t (missing — 「단면 S2 두께 t」).
 */
export function spanSectionsBody(st: CaseState, ctx: RequestContext): { data?: { span_sections: string[]; sections: any[] }; missing: string[]; error?: string } {
    const r = DS.spanSectionsPayload(st.spans.spanSections, st.sections, ctx.drafts.templateType);
    return { ...(r.data ? { data: r.data } : {}), missing: (r.missing || []).map((m: any) => m.label), ...(r.error ? { error: r.error } : {}) };
}

/** 자동 계산 모드의 설계 검토(runPurlinDesign → design_purlin) — app.js btn-run-design 의 본문 그대로 */
export function buildPurlinRequest(st: CaseState, ctx: RequestContext, loadOpts: LoadRequestOptions = {}): BuiltRequest {
    const design = buildDesignRequest(st, ctx);
    const loads = buildLoadRequest(st, ctx, loadOpts);
    if (design.missing.length) {
        // 화면은 설계 본문의 빈 필수 칸(설계 Fy)을 먼저 막는다
        return { missing: design.missing, missingKeys: design.missingKeys };
    }
    if (loads.error || loads.missing.length || !loads.data) { return loads; }
    const opts: any = {};
    for (const k of ['use_inelastic_reserve', 'use_cold_work', 'wc_N', 'wc_R', 'wc_fastened', 'wc_web_config',
        'wc_section_family', 'wc_flange_condition', 'wc_overhang', 'wc_edge_distance', 'wc_n_webs', 'wc_support_fastener_spacing']) {
        if (design.data[k] !== undefined) { opts[k] = design.data[k]; }
    }
    // 계약 §6.3: 사람이 밝힌 랩 구속(확인했을 때만 — 없음 = 밝히지 않음)
    if (new Reader(st, ctx.drafts).chk('lapRestrained')) { opts.lap_restrained = true; }
    // 결정 T6 · T7: 구멍 · 횡방향 웹 보강재는 구간 검토에 그대로(§H4 는 자동 계산 넷에 쓰지 않는다 — 'purlin' 범위가 넣지 않는다)
    for (const [k, v] of Object.entries(design.data)) { if (isWebOptionKey(k)) { opts[k] = v; } }
    return { data: { ...loads.data, ...opts, Fy: design.data.Fy, Fu: design.data.Fu }, missing: [] };
}

/** 랩 접합(runLapConnection → lap_connection) — app.js btn-run-lap-design 그대로(결과에 기대는 Se · Sf · Mnd · Vn 포함) */
export function buildLapRequest(st: CaseState, ctx: RequestContext): BuiltRequest {
    const r = new Reader(st, ctx.drafts);
    const lpSx = ctx.props ? (ctx.props.Sx || 0) : 0;
    // V8-01: 단면 강도는 퍼린 결과의 그 지점 랩 구간에서만(지배 구간이 아니다) — 화면과 같은 함수(utils.deriveLapSection)
    const sec = lapSectionFor(st, ctx);
    const haveSe = sec.Se !== null;
    const lpSe = sec.Se ?? undefined;
    const lpVn = sec.Vn ?? undefined;
    const data: any = {
        d: r.req('tplH', '단면 높이 H'),
        t: r.req('tplT', '두께 t'),
        Fy: r.req('fy', '설계 Fy'),
        Fu: r.req('fu', '설계 Fu'),
        lap_left_in: r.req('connLapLeft', '좌측 Lap'),
        lap_right_in: r.req('connLapRight', '우측 Lap'),
        // V9a-02: 비운 칸은 보내지 않는다(0 으로 채우지 않는다) — 엔진이 그 소요를 쓰는 검토를 「판정 없음」 으로
        Mu_support: r.opt('connMu'),
        Vu_support: r.opt('connVu'),
        fastener_type: r.sel('connFastenerType', 'screw'),
        fastener_dia: r.req('connFastenerDia', '패스너 직경 d'),
        n_rows: r.req('connNRows', '행 수'),
        end_distance: r.opt('connEdgeDist'),
        Pnvs: r.opt('connLapPnvs'),
        design_method: r.sel('designMethod', 'LRFD'),
        Se: lpSe,
        Sf: haveSe ? lpSx : undefined,
        Vn: lpVn,
    };
    // 계약 §6.3: 랩 구속의 진술 — 검토 상태의 lapRestrained(화면 칸 · MCP · 파일이 같은 키). 확인했을 때만 넣는다
    if (r.chk('lapRestrained')) { data.lap_restrained = true; }
    // 계약 §6.3: 0 은 밝혔을 때만 0(사람의 칸 · AI 의 zero_demand_stated)
    if (r.chk('connZeroDemandStated')) { data.zero_demand_stated = true; }
    // 결정 R2: 패스너 힘 분배(모든 패스너가 고르게 — 자체 가정)로 판정함을 사람이 밝혔을 때만(없음 = 밝히지 않음 → 패스너 무리는 판정 없음)
    if (r.chk('lapForceModelConfirmed')) { data.lap_force_model_confirmed = true; }
    // 2026-11-28 결정 S1 · S5: 경간마다 단면인 퍼린 결과의 그 지점 랩이 두 단면을 이으면 두 부재(부재 1 = 왼쪽 경간, 부재 2 = 오른쪽) — 화면과 같은 함수.
    // 두 부재가 모두 S1 이면 본문은 지금까지와 같다
    UTILS.applyLapTwoMembers(data, sec.two ?? null);
    return { data, missing: r.missing, missingKeys: r.missingKeys };
}

/** V8-01: 랩 검토의 단면 강도(그 지점의 랩 구간에서) — 호스트가 결과에 출처를 적을 때도 같은 것을 부른다 */
export function lapSectionFor(st: CaseState, ctx: RequestContext): { Se: number | null; Vn: number | null; from: string | null; regions: string[]; support: number | null; reason: string | null;
    support_defaulted?: boolean; two?: any } {
    const sup = st.inputs.connLapSupport;
    let support = typeof sup === 'number' && Number.isInteger(sup) ? sup : null;
    // 결정 S1: 경간마다 단면인 퍼린 결과에서 지점을 정하지 않았으면 그 결과의 지배 랩(그 밖의 결과는 지금까지처럼 지점이 있어야 한다)
    let defaulted = false;
    if (support === null) { const g = UTILS.governingLapSupport(ctx.purlin ?? null); if (g !== null) { support = g; defaulted = true; } }
    const stated = st.inputs.lapRestrained === true;
    const r = UTILS.deriveLapSection(ctx.purlin ?? null, support, { stated });
    const two = UTILS.lapTwoMembers(ctx.purlin ?? null, support, { stated });
    return { ...r, ...(defaulted ? { support_defaulted: true } : {}), ...(two ? { two } : {}) };
}

/** 단일 접합(runConnection → design_connection) — app.js btn-run-single-conn 그대로 */
export function buildConnectionRequest(st: CaseState, ctx: RequestContext): BuiltRequest {
    const r = new Reader(st, ctx.drafts);
    const connType = r.sel('connSingleType', 'screw');
    const data: any = {
        connection_type: connType,
        t1: r.req('connT1', 't1'),
        Fy: r.req('connFy', '접합 Fy'),
        Fu: r.req('connFu', '접합 Fu'),
        Pu: r.opt('connPu'),
        design_method: r.sel('designMethod', 'LRFD'),
    };
    for (const [k, key] of [['Tu', 'connTu'], ['e', 'connE'], ['s', 'connS'], ['width', 'connWidth']] as const) {
        const v = r.opt(key);
        if (v !== undefined) { data[k] = v; }
    }
    const mcase = typeof st.inputs.connMemberCase === 'string' ? st.inputs.connMemberCase : '';
    if (mcase) { data.member_case = mcase; }
    if (r.chk('connJ63NotApplicable')) { data.j6_3_not_applicable = true; }
    if (connType === 'screw' || connType === 'paf' || connType === 'bolt') {
        const dw = r.opt('connDw');
        if (dw !== undefined) { data.dw = dw; }
    }
    if (connType === 'screw') {
        const pnvs = r.opt('connPnvs');
        if (pnvs !== undefined) { data.Pnvs = pnvs; }
    }
    for (const [k, key] of [['t2', 'connT2'], ['d', 'connD'], ['n', 'connN']] as const) {
        const v = r.opt(key);
        if (v !== undefined) { data[k] = v; }
    }
    if (['fillet_weld', 'arc_spot', 'arc_seam', 'groove'].includes(connType)) {
        const wl = r.opt('connWeldL');
        const ws = r.opt('connWeldSize');
        if (wl !== undefined) { data.weld_length = wl; }
        if (ws !== undefined) { data.weld_size = ws; }
    }
    if (connType === 'groove') { data.groove_type = r.sel('connGrooveType', 'complete'); }
    if (connType === 'bolt' || connType === 'screw') {
        const fub = r.opt('connFub');
        if (fub !== undefined) { data.Fub = fub; }
    }
    if (connType === 'paf') {
        const fuf = r.opt('connFuf');
        if (fuf !== undefined) { data.Fuf = fuf; }
    }
    return { data, missing: r.missing, missingKeys: r.missingKeys };
}

/**
 * 모델 → 모델 칸의 값(US) — 화면이 없을 때(MCP · 독립 프로그램의 화면 없는 길) 초안 대신. app.js _syncAnalysisWidgetsFromModel 과
 * 같은 규칙(템플릿으로 만든 모델이면 그 종류와 치수, 아니면 템플릿 '').
 */
export function modelDrafts(model: any): Record<string, InputValue> {
    const out: Record<string, InputValue> = {};
    const m = model || {};
    if (typeof m.sectionTemplate === 'string' && m.sectionTemplate) {
        const sp = m.sectionParams || {};
        const isChs = m.sectionTemplate === 'chs';
        out.templateType = m.sectionTemplate;
        const n = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : (v != null && isFinite(Number(v)) ? Number(v) : null));
        out.tplH = n(isChs ? (sp.OD ?? sp.H) : sp.H);
        out.tplB = isChs ? null : n(sp.B);
        out.tplD = n(sp.D);
        out.tplT = n(sp.t);
        out.tplR = n(sp.r);
        out.tplQlip = n(sp.qlip);
    } else {
        out.templateType = '';
    }
    return out;
}
