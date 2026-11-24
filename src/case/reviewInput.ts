/**
 * K3-2 — 검증 · 보고서(webview/js/review.js)의 입력을 호스트가 만든다. 화면이 없어도 같은 항목 · 같은 보고서.
 *
 * review.js 의 함수 몸은 app.js 에서 글 그대로 옮긴 것이라 「칸」 을 읽는다(getElementById · querySelector(All) · getNum · _optNum).
 * 여기서 만드는 가짜 문서는 그 칸을 검토 상태(K2 CaseState) · 모델 칸의 초안 · 화면의 HTML(선택 칸의 글)로 채운다 — 화면이 같은 값을
 * 적는 규칙 그대로: 수 칸의 글은 지금 단위의 12 자리(designState._applyValues · refreshUnits 와 같은 식), 정확한 US 값은 dataset 에
 * (designState.exactOf 가 읽는다). 결과의 사본은 CaseKeeper.pageView(화면의 처리기와 같은 규칙으로 적고 지운 것).
 *
 * 시험 모드에서는 화면이 만든 검증 · 보고서와 이것이 만든 것을 맞댄다(test/rendered/k3 — 그림자).
 */
const DS = require('../../webview/js/designState');

export interface ReviewSources {
    /** 검토 상태의 1.3 모양 입력(toDesignInputs13 — 모델 칸의 초안 포함), US */
    inputs: Record<string, unknown>;
    /** 경간 표 {spans, supports, lapsPerSupport} (US ft) */
    spans: { spans?: (number | null)[]; supports?: string[]; lapsPerSupport?: ({ left: number | null; right: number | null } | null)[] } | null;
    unitSystem: 'SI' | 'US';
    /** 화면 HTML 의 선택 칸 선택지(id → [{value, text}]) */
    options: Record<string, { value: string; text: string }[]>;
}

/**
 * 화면 없이(초안을 받은 적이 없을 때) 해석 조건 칸 — 화면이 modelLoaded 로 칸에 적는 것(app.js _syncAnalysisWidgetsFromModel)과 같은 원천:
 * 재료(prop[0]: E · ν · G), 경계조건, 하중 경우, 고유치 수, 반파장 최소 · 최대 · 개수.
 */
export function modelAnalysisDrafts(model: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const m = model || {};
    const p = Array.isArray(m.prop) && Array.isArray(m.prop[0]) ? m.prop[0] : null;
    if (p) { out.inputE = p[1]; out.inputV = p[3]; out.inputG = p[5]; }
    if (typeof m.BC === 'string') { out.analysisBC = m.BC; }
    if (typeof m.loadCase === 'string') { out.analysisLoadCase = m.loadCase; }
    if (Number.isInteger(m.neigs) && m.neigs > 0) { out.analysisNeigs = m.neigs; }
    const L = Array.isArray(m.lengths) ? m.lengths.map(Number).filter((v: number) => isFinite(v) && v > 0) : [];
    if (L.length > 0) { out.analysisLenMin = Math.min(...L); out.analysisLenMax = Math.max(...L); out.analysisLenN = L.length; }
    return out;
}

/** 화면 HTML 에서 <select id="…"> 의 선택지를 읽는다(option.text 처럼 공백을 접고 앞뒤를 자른다). */
export function selectOptionsFromHtml(html: string): Record<string, { value: string; text: string }[]> {
    const out: Record<string, { value: string; text: string }[]> = {};
    const decode = (t: string) => t.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    for (const m of html.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
        const opts: { value: string; text: string }[] = [];
        for (const o of m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)) {
            const vm = /\bvalue="([^"]*)"/.exec(o[1]);
            const text = decode(o[2]);
            opts.push({ value: vm ? vm[1] : text, text });
        }
        out[m[1]] = opts;
    }
    return out;
}

class FakeEl {
    value = '';
    checked = false;
    selectedIndex = -1;
    options: { value: string; text: string }[] = [];
    dataset: Record<string, string> = {};
    innerHTML = '';
    constructor(public id: string | null, public className = '') { }
    getAttribute(n: string): string | null { return n.startsWith('data-') ? (this.dataset[n.slice(5).replace(/-(\w)/g, (_m, c) => c.toUpperCase())] ?? null) : null; }
}

function shownText(v: number, unit: string | null, unitSystem: 'SI' | 'US'): string {
    const f = unit && DS.UNIT_FACTORS[unit];
    const d = unitSystem === 'SI' && f ? v * f : v;
    return String(Number(Number(d).toPrecision(12)));
}

/** review.js 의 env.doc — getElementById · querySelector · querySelectorAll 만 */
export function buildReviewDoc(src: ReviewSources): any {
    const byId = new Map<string, FakeEl>();
    for (const row of DS.FIELDS) {
        const [key, id, unit, kind] = row as [string, string, string | null, string];
        const v = src.inputs[key];
        const el = new FakeEl(id);
        if (kind === 'chk') { el.checked = !!v; }
        else if (kind === 'sel') {
            el.options = src.options[id] || [];
            el.value = v == null ? '' : String(v);
            el.selectedIndex = el.options.findIndex((o) => o.value === el.value);
            // 빈 선택(AI: 주지 않음)이나 선택지 밖의 값: 화면의 선택 칸은 늘 무언가를 보인다 — 처음 값의 선택지, 없으면 첫째
            if (el.selectedIndex < 0 && el.options.length) {
                const def = DS.defaultValue(key);
                const di = el.options.findIndex((o) => o.value === String(def));
                el.selectedIndex = di >= 0 ? di : 0;
                el.value = el.options[el.selectedIndex].value;
            }
        } else if (kind === 'list') {
            el.value = Array.isArray(v) && v.length > 0
                ? v.map((x: number) => String(Number((unit && src.unitSystem === 'SI' && DS.UNIT_FACTORS[unit] ? x * DS.UNIT_FACTORS[unit] : x).toPrecision(6)))).join(', ')
                : '';
        } else if (typeof v === 'number' && isFinite(v)) {
            el.value = unit ? shownText(v, unit, src.unitSystem) : String(v);
            if (unit) { el.dataset.caseExact = String(v); el.dataset.caseShown = el.value; }
        } else { el.value = v == null ? '' : String(v); }
        byId.set(id, el);
    }
    // 경간 표(app.js buildSpanTable 의 칸 규칙)
    const sp = src.spans || {};
    const st = String(src.inputs.spanType || '');
    const isSimple = st === 'simple' || st === 'cantilever';
    const spans = Array.isArray(sp.spans) ? sp.spans : [];
    const n = spans.length;
    const len: FakeEl[] = [], sup: FakeEl[] = [], lapl: FakeEl[] = [], lapr: FakeEl[] = [];
    const lenText = (v: number | null | undefined) => (v == null || !isFinite(v) ? '' : shownText(v, 'length_ft', src.unitSystem));
    for (let i = 0; i <= n; i++) {
        const s = new FakeEl(null, 'span-tbl-sup'); s.dataset.idx = String(i); s.value = (sp.supports && sp.supports[i]) || 'P'; sup.push(s);
        if (i < n) { const e = new FakeEl(null, 'span-tbl-len'); e.dataset.idx = String(i); e.value = lenText(spans[i]); len.push(e); }
        const lp = (sp.lapsPerSupport && sp.lapsPerSupport[i]) || null;
        if (i > 0 && !isSimple) { const e = new FakeEl(null, 'span-tbl-lapl'); e.dataset.idx = String(i); e.value = lenText(lp ? lp.left : 0); lapl.push(e); }
        if (i < n && !isSimple) { const e = new FakeEl(null, 'span-tbl-lapr'); e.dataset.idx = String(i); e.value = lenText(lp ? lp.right : 0); lapr.push(e); }
    }
    const classes: Record<string, FakeEl[]> = { 'span-tbl-len': len, 'span-tbl-sup': sup, 'span-tbl-lapl': lapl, 'span-tbl-lapr': lapr };
    const all = (sel: string): FakeEl[] => {
        const m = /^\.([\w-]+)(?:\[data-idx="(\d+)"\])?$/.exec(sel.trim());
        if (m) { const list = classes[m[1]] || []; return m[2] === undefined ? list : list.filter((e) => e.dataset.idx === m[2]); }
        const h = /^#([\w-]+)$/.exec(sel.trim());
        if (h) { const e = byId.get(h[1]); return e ? [e] : []; }
        return [];
    };
    return {
        getElementById: (id: string) => byId.get(id) || null,
        querySelectorAll: (sel: string) => all(sel),
        querySelector: (sel: string) => all(sel)[0] || null,
    };
}
