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
    /** 하중 본문의 형식 오류(브레이스 · 경간별 Ix) — 화면의 그 문장 */
    error?: string;
}

const CALC_MODES = ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'];
export const isCalcMode = (t: unknown): boolean => CALC_MODES.includes(String(t));

class Reader {
    missing: string[] = [];
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
        if (typeof v !== 'number' || !isFinite(v)) { this.missing.push(label); return NaN; }
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
    return { data, missing: r.missing };
}

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

/** 하중 분석(analyzeLoads → analyze_loads) — app.js collectLoadAnalysisPayload 그대로. 자동 계산 모드가 아니면 data 없음 */
export function buildLoadRequest(st: CaseState, ctx: RequestContext): BuiltRequest {
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
    const t = String(secType || '').toLowerCase();
    const table: Record<string, string> = { lippedc: 'C', lippedz: 'Z', track: 'Track', hat: 'Hat', rhs: 'RHS', chs: 'CHS',
        isect: 'I', tee: 'Tee', angle: 'Angle', lipped_angle: 'LippedAngle' };
    const normalizedSectionType = table[t] || 'custom';
    const isHat = normalizedSectionType === 'Hat';
    const hasLip = ['C', 'Z', 'LippedAngle'].includes(normalizedSectionType);
    const sectionInfo: any = {
        depth: r.req(isHat ? 'tplB' : 'tplH', isHat ? '단면 B(깊이)' : '단면 H'),
        flange_width: r.req(isHat ? 'tplH' : 'tplB', isHat ? '단면 H(상판 폭)' : '단면 B'),
        thickness: r.req('tplT', '단면 t'),
        lip_depth: hasLip ? r.req('tplD', '립 D') : 0,
        R_corner: r.opt('tplR'),
        type: normalizedSectionType,
        Fy: r.req('fy', '설계 Fy'),
        Fu: r.opt('fu'),
        Ixx: ctx.props ? ctx.props.Ixx : undefined,
    };
    const spanLens: number[] = [];
    st.spans.spans.forEach((v, i) => {
        if (typeof v !== 'number' || !isFinite(v)) { r.missing.push('경간 ' + (i + 1) + ' 길이'); spanLens.push(NaN); return; }
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
    if (r.missing.length > 0) { return { missing: r.missing }; }
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
    return { data, missing: [] };
}

/** 자동 계산 모드의 설계 검토(runPurlinDesign → design_purlin) — app.js btn-run-design 의 본문 그대로 */
export function buildPurlinRequest(st: CaseState, ctx: RequestContext): BuiltRequest {
    const design = buildDesignRequest(st, ctx);
    const loads = buildLoadRequest(st, ctx);
    if (design.missing.length) {
        // 화면은 설계 본문의 빈 필수 칸(설계 Fy)을 먼저 막는다
        return { missing: design.missing };
    }
    if (loads.error || loads.missing.length || !loads.data) { return loads; }
    const opts: any = {};
    for (const k of ['use_inelastic_reserve', 'use_cold_work', 'wc_N', 'wc_R', 'wc_fastened', 'wc_web_config',
        'wc_section_family', 'wc_flange_condition', 'wc_overhang', 'wc_edge_distance', 'wc_n_webs', 'wc_support_fastener_spacing']) {
        if (design.data[k] !== undefined) { opts[k] = design.data[k]; }
    }
    // 계약 §6.3: 사람이 밝힌 랩 구속(확인했을 때만 — 없음 = 밝히지 않음)
    if (new Reader(st, ctx.drafts).chk('lapRestrained')) { opts.lap_restrained = true; }
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
    return { data, missing: r.missing };
}

/** V8-01: 랩 검토의 단면 강도(그 지점의 랩 구간에서) — 호스트가 결과에 출처를 적을 때도 같은 것을 부른다 */
export function lapSectionFor(st: CaseState, ctx: RequestContext): { Se: number | null; Vn: number | null; from: string | null; regions: string[]; support: number | null; reason: string | null } {
    const sup = st.inputs.connLapSupport;
    const support = typeof sup === 'number' && Number.isInteger(sup) ? sup : null;
    return UTILS.deriveLapSection(ctx.purlin ?? null, support, { stated: st.inputs.lapRestrained === true });
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
    return { data, missing: r.missing };
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
