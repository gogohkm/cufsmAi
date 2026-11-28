/**
 * K2 — 호스트가 쥔 검토 상태와, 화면 쪽 사정(초안 · 마지막 단면 성질 · 화면이 쥔 마지막 설계 · Lap 결과)의 거울.
 * 순수(vscode 없음) — StcfsdPanel 이 메시지를 넘긴다. 설계: docs/implementation/20261123-k2-design.md §3 · §4.
 *
 * 화면 쪽 거울이 필요한 까닭: 지금 화면의 엔진 본문은 화면이 쥔 것(모델 칸의 초안, lastProps, 화면이 고른 퍼린 지배 구간)에도 기댄다.
 * 호스트가 같은 본문을 만들려면(§4.3 — B1 뒤로는 수가 화면이 적는 자리에서 같으면 같다: compare) 같은 것을 알아야 한다. 화면이 받는 메시지를 호스트가 보낼 때 같이 적는다.
 */
import { CaseState, InputValue, Source, applyChanges, createCaseState, ApplyResult, replaceGroup } from './caseState';
import { McpWrite } from './mcpGroups';
import { RequestContext, modelDrafts } from './requests';

const UTILS = require('../../webview/js/utils');

/** V9b-05: 화면의 caseEdit.origin — 닫힌 집합. 그 밖의 글은 받지 않는다 */
export const PAGE_ORIGINS = new Set(['user', 'mirror', 'file', 'unit-toggle', 'load-analysis']);
/** 화면이 지금 상태를 그려 다시 읽은 메아리일 수 있는 출처 — 상태의 값과 보이는 자리 안에서 같을 때만 그것으로 받는다 */
export const ECHO_ORIGINS = new Set(['mirror', 'file', 'unit-toggle']);

/** 화면의 caseEdit.origin → 상태의 출처(값을 바꾼 칸의 꼬리표는 사실대로 — mirror · file. 단위 바꿈은 출처를 바꾸지 않는다) */
function writerOf(origin: unknown): { writer: Source; keepSource: boolean } {
    switch (origin) {
        case 'user': return { writer: 'user', keepSource: false };
        case 'file': return { writer: 'file', keepSource: true };
        case 'load-analysis': return { writer: 'load-analysis', keepSource: false };
        case 'unit-toggle': return { writer: 'mirror', keepSource: true };
        default: return { writer: 'mirror', keepSource: true };
    }
}

/**
 * B1: 「화면이 적는 자리에서 같은가」 는 한 함수 — webview/js/designState.js 의 shownSame(12 자리 · 목록 6 자리, 그 까닭은 그 머리말).
 * K2 불변식(compare · 시험의 상태 = 칸)도 같은 함수를 쓴다. 화면이 지금 상태를 그린 칸을 다시 읽어 알린 수(단위를 오간 왕복의 마지막 자리 —
 * 「Fy 295 → 294.9999999999998 MPa」)는 새 값이 아니다.
 */
const DSJ = require('../../webview/js/designState');
const SHOWN_DIGITS: number = DSJ.SHOWN_DIGITS;
const SHOWN_DIGITS_LIST: number = DSJ.SHOWN_DIGITS_LIST;
// 결정 S1: 경간 표의 넷째 칸(경간의 단면)도 표의 키. 단면 목록(sections)은 표 밖의 한 키
const SPAN_KEY_LIST = ['spans', 'supports', 'lapsPerSupport', 'spanSections'];
/** 상태에서 키 k 의 지금 값(입력 · 경간 표 · 단면 목록) */
function curOf(st: CaseState, k: string): unknown {
    if (SPAN_KEY_LIST.includes(k)) { return (st.spans as any)[k]; }
    if (k === 'sections') { return st.sections; }
    return st.inputs[k];
}
function sameShown(a: unknown, b: unknown, unit: string | null, systems: string[], digits: number): boolean {
    return DSJ.shownSame(a, b, { unit, systems, digits });
}

export interface ShadowRecord { what: string; same: boolean; page?: string; host?: string; at: number }

export class CaseKeeper {
    state: CaseState = createCaseState();
    /** 화면이 알린 모델 칸의 값(초안). 화면이 붙은 적이 없으면 null — 그때는 모델에서 만든다 */
    drafts: Record<string, InputValue> | null = null;
    /** 화면이 마지막으로 받은 단면 성질(propertiesResult) */
    props: any = null;
    /** 화면의 _lastDesignResult 거울(designResult 그대로 · 퍼린이면 지배 구간) */
    pageDesign: any = null;
    /** 화면의 _lastLapResult 거울 */
    pageLap: any = null;
    /** V8-01: 화면의 _lastPurlinResult 거울(퍼린 결과 묶음 그대로 — 랩 검토의 단면 강도를 그 지점의 랩 구간에서) */
    pagePurlin: any = null;
    /**
     * K3: 화면이 쥐는 나머지 결과의 거울(검증 · 보고서의 입력 — webview/js/review.js 의 env). 화면의 처리기와 같은 규칙으로 적고 지운다:
     * model ← modelLoaded, analysis ← analysisComplete(곡선 줄 정규화), dsm ← dsmResult, load ← loadAnalysisComplete(오류가 아니면) ·
     * 퍼린 결과의 load_analysis. 지우기는 화면의 clearStaleResults(scope) 그대로.
     */
    pageView: { model: any; analysis: any; dsm: any; load: any } = { model: null, analysis: null, dsm: null, load: null };
    /** 시험 모드: 화면 본문 ↔ 호스트 본문, 처음 값 대조 */
    shadow: ShadowRecord[] = [];
    helloMismatch: string[] | null = null;
    /** 화면이 처음 값을 알린 횟수(두 번째부터는 새로 고침 — 호스트의 상태를 다시 보낸다) */
    private hellos = 0;
    /** 저장 · 열기 때의 판과 모델 서명(저장 안 한 변경 — 설계 §7) */
    private savedRev = 0;
    private savedModelSig: string | null = null;

    /** 호스트 → 화면 메시지를 보낼 때 — 화면이 그 메시지로 바꾸는 것을 같이 적는다(app.js 의 처리기와 같은 규칙). */
    onPosted(command: string, data: any): void {
        const v = this.pageView;
        switch (command) {
            case 'propertiesResult': this.props = data; break;
            case 'modelLoaded': v.model = data; break;
            case 'analysisComplete':
                // app.js 와 같은 정규화: [[10, 0.05, …]] → [10, 0.05, …]
                v.analysis = data && Array.isArray(data.curve)
                    ? { ...data, curve: data.curve.map((row: any) => (Array.isArray(row) && row.length === 1 && Array.isArray(row[0]) ? row[0] : row)) }
                    : data;
                break;
            case 'dsmResult': v.dsm = data; break;
            case 'loadAnalysisComplete': if (data && !data.error) { v.load = data; } break;
            case 'designResult':
                if (data && data.design_positive) { v.load = data.load_analysis || v.load; }
                this.pageDesign = data && data.design_positive ? UTILS.pickGoverningPurlinDesign(data) : data;
                this.pagePurlin = data && data.design_positive ? data : null;
                break;
            case 'designPurlinResult':
                v.load = (data && data.load_analysis) || v.load;
                this.pageDesign = UTILS.pickGoverningPurlinDesign(data);
                this.pagePurlin = data || null;
                break;
            case 'lapConnectionResult': this.pageLap = data; break;
            // 다시 실은 뒤의 창은 호스트가 **새** 상태(AI · 호스트의 쓰기 — 'ai' · 'merged')를 보내면 닫힌다: 그 상태를 그리며 낸 화면의 연동은
            // 지금까지처럼 받는다. 다시 싣기 · 충돌 때 다시 보내는 상태는 창을 닫지 않는다
            case 'caseState': if (data && data.reason !== 'page reloaded' && data.reason !== 'conflict') { this.reloadWindow = false; } break;
            case 'analysisInvalidated': this.clearStale(data && data.invalidateLoads ? 'model' : 'analysis'); break;
            case 'resultsCleared': this.clearStale('all'); break;
            case 'derivedResultsInvalidated': {
                const sc = data && data.scope;
                // V7-40: scope 'kinds' 는 다시 보내기 · 둘째 화면을 위한 이름표(그 결과는 호스트가 이미 지웠고 화면에는 따로 알렸다) — 거울은 그대로
                if (sc === 'kinds') { break; }
                this.clearStale(sc === 'load' ? 'load' : (sc === 'lap' || sc === 'connection') ? sc : 'design');
                break;
            }
            default: break;
        }
    }

    /** 화면이 스스로 결과를 지웠다(invalidateDerivedResults — 화면의 clearStaleResults 와 같은 범위) */
    onPageInvalidated(scope?: unknown): void {
        this.clearStale(scope === 'load' ? 'load' : (scope === 'lap' || scope === 'connection') ? scope : 'design');
    }

    /** app.js clearStaleResults(scope) 의 거울 — 결과 사본만(화면의 글은 화면이 지운다) */
    private clearStale(scope: string): void {
        // D-4(K2-7): 접합부 탭의 범위는 그 결과만 — 'connection' 은 단일 접합(거울 없음), 'lap' 은 Lap 결과만
        if (scope === 'connection') { return; }
        if (scope === 'lap') { this.pageLap = null; return; }
        const order = ['design', 'load', 'analysis', 'model', 'all'];
        const lvl = order.indexOf(scope) < 0 ? 0 : order.indexOf(scope);
        const has = (x: string) => lvl >= order.indexOf(x);
        this.pageDesign = null;
        this.pagePurlin = null;
        this.pageLap = null;
        if (scope === 'load' || has('model')) { this.pageView.load = null; }
        if (scope !== 'design' && scope !== 'load') { this.pageView.analysis = null; this.pageView.dsm = null; }
    }

    /**
     * 결정 D1 · D8: MCP 설계 도구의 인자를 상태에 합친 모습 — 쓰지 않는다(호출자가 그 상태로 본문을 만들고, 계산이 성공한 뒤 applyMcp).
     * 받은 키(합치기), 묶음 인자의 칸(묶음째로 — 빠진 성분 null), 경간 표의 받은 부분, mcpOnly[도구]. 경간 유형 · 수가 바뀌어 표가 맞지
     * 않으면 처음 값(applyChanges — 화면 · set_case_inputs 와 같은 규칙). 반환: 값이 바뀐 키, 사람이 정했던 값 가운데 바뀐 것(그 전 값 · 출처).
     */
    mergeMcp(w: McpWrite, base: CaseState = this.state): { state: CaseState; written: string[]; replaced: { key: string; previous: InputValue | any; previous_source: Source }[] } {
        const before = JSON.parse(JSON.stringify(base)) as CaseState;
        let st = applyChanges(base, w.merge, 'ai').state;
        if (Object.keys(w.group).length) { st = replaceGroup(st, Object.keys(w.group), w.group, 'ai').state; }
        // 결정 S1: 단면 목록 · 경간의 단면 — 묶음째로(받은 것이 새 값). 단면 목록이 먼저(경간 표 · 경간의 단면이 그 id 를 쓴다)
        if (w.sections !== undefined) { st = applyChanges(st, { sections: w.sections }, 'ai').state; }
        if (w.spans && Object.keys(w.spans).length) { st = applyChanges(st, { ...w.spans }, 'ai').state; }
        if (w.spanSections !== undefined) { st = applyChanges(st, { spanSections: w.spanSections }, 'ai').state; }
        st.mcpOnly = { ...st.mcpOnly, [w.tool]: JSON.parse(JSON.stringify(w.mcpOnly)) };
        const written: string[] = [];
        const replaced: { key: string; previous: any; previous_source: Source }[] = [];
        const person: Source[] = ['user', 'file', 'load-analysis'];
        for (const k of Object.keys(st.inputs)) {
            if (JSON.stringify(st.inputs[k]) === JSON.stringify(before.inputs[k])) { continue; }
            written.push(k);
            if (person.includes(before.sources[k]) && before.inputs[k] !== null) {
                replaced.push({ key: k, previous: before.inputs[k], previous_source: before.sources[k] });
            }
        }
        for (const k of [...SPAN_KEY_LIST, 'sections']) {
            if (JSON.stringify(curOf(st, k)) === JSON.stringify(curOf(before, k))) { continue; }
            written.push(k);
            if (person.includes(before.sources[k])) { replaced.push({ key: k, previous: curOf(before, k), previous_source: before.sources[k] }); }
        }
        if (written.length && st.rev === before.rev) { st.rev = before.rev + 1; }
        return { state: st, written, replaced };
    }

    /** 합친 상태를 확정한다(지금 상태에 다시 합친다 — 계산 동안 들어온 화면의 변경을 잃지 않게). 반환은 mergeMcp 와 같은 목록 */
    applyMcp(w: McpWrite): { rev: number; written: string[]; replaced: { key: string; previous: InputValue | any; previous_source: Source }[]; skipped: McpWrite['skipped'] } {
        const m = this.mergeMcp(w);
        this.state = m.state;
        return { rev: m.state.rev, written: m.written, replaced: m.replaced, skipped: w.skipped };
    }

    /** 저장 안 한 변경이 처음 생긴 때(없으면 null) — touch 가 고친다 */
    dirtySince: string | null = null;
    /** 상태 · 모델이 바뀐 뒤 부른다 — 저장 안 한 변경이 생긴 때를 적는다 */
    touch(modelSig: string): boolean {
        const d = this.isDirty(modelSig);
        if (d && !this.dirtySince) { this.dirtySince = new Date().toISOString(); }
        if (!d) { this.dirtySince = null; }
        return d;
    }
    /** 저장 · 열기 뒤에 바뀐 입력 키 */
    changedSinceSaved(): string[] {
        return Object.keys(this.state.revs).filter((k) => (this.state.revs[k] ?? 0) > this.savedRev);
    }
    /** 저장 · 열기 뒤에 모델이 바뀌었나 */
    modelChangedSinceSaved(modelSig: string): boolean { return this.savedModelSig !== null && this.savedModelSig !== modelSig; }

    /** 화면의 caseEdit {origin, changes, drafts?, baseRev?} */
    /**
     * 화면이 seenRev 판을 보고 보낸 변경을 받았는데, 그 사이(seenRev, before] 에 AI 가 쓴 키가 있다 — 화면은 그 사이 caseState 로
     * 칸을 덮었을 수 있다(예: MCP analyze_loads 의 결과로 채운 값이 뒤이은 caseState 에 덮인다). 호출자가 상태를 다시 보낸다.
     */
    staleView(seenRev: unknown, before: number): boolean {
        if (!Number.isInteger(seenRev) || (seenRev as number) >= before) { return false; }
        const seen = seenRev as number;
        return Object.keys(this.state.revs).some((k) => this.state.revs[k] > seen && this.state.revs[k] <= before && this.state.sources[k] === 'ai');
    }

    /** V9b-05: 메아리 출처의 변경 가운데 상태의 값과 보이는 자리 안에서 다른 키(그것은 사람의 편집이다) */
    nonEchoKeys(changes: unknown, origin?: unknown): string[] {
        const raw: Record<string, unknown> = changes && typeof changes === 'object' ? changes as any : {};
        return Object.keys(raw).filter((k) => !this.shownSameAsState(k, raw, origin));
    }

    /**
     * B1: 화면이 알린 키 k 의 값이 지금 상태의 값과 화면이 적는 자리(SHOWN_DIGITS — 목록은 메아리 출처에서 SHOWN_DIGITS_LIST)에서 같은가.
     * 단위계는 화면의 지금 것(이 변경이 unitSystem 을 함께 알리면 그것, 아니면 상태의 것) — 단위 바꿈(unit-toggle)은 앞 · 뒤 둘 다
     * (칸의 글이 앞 단위계의 12 자리에서 바뀌어 왔다). 단위 없는 키(선택 · 체크 · 글)는 글자까지 — unitSystem · 보기 설정은 늘 「다르다」(그대로 둔다).
     */
    private shownSameAsState(k: string, raw: Record<string, unknown>, origin: unknown): boolean {
        const c = this.shownCtx(k, raw, origin);
        // 결정 S1: 단면 목록은 치수마다 그 단위로(designState.sectionsShownSame)
        if (c !== null && k === 'sections') { return DSJ.sectionsShownSame(c.cur, raw[k], { systems: c.systems, digits: c.digits }); }
        return c !== null && sameShown(c.cur, raw[k], c.unit, c.systems, c.digits);
    }
    /** 키 k 를 견줄 것 — 지금 값 · 단위 · 단위계 · 자리(unitSystem · 보기 설정은 null — 견주지 않는다) */
    private shownCtx(k: string, raw: Record<string, unknown>, origin: unknown): { cur: unknown; unit: string | null; systems: string[]; digits: number } | null {
        if (k === 'unitSystem') { return null; }
        const DS = require('../../webview/js/designState');
        const m = DS.fieldMeta(k);
        if (m && m.owner === 'view') { return null; }
        const key = m && m.owner === 'mirror' ? m.mirrorOf : k;
        const isSpan = SPAN_KEY_LIST.includes(key);
        const cur = curOf(this.state, key);
        const unit: string | null = isSpan ? (key === 'supports' || key === 'spanSections' ? null : 'length_ft') : (m && m.unit) || null;
        const sys = raw.unitSystem === 'US' || raw.unitSystem === 'SI' ? String(raw.unitSystem) : this.state.view.unitSystem;
        const systems = origin === 'unit-toggle' ? ['SI', 'US'] : [sys];
        const digits = m && m.kind === 'list' && ECHO_ORIGINS.has(String(origin)) ? SHOWN_DIGITS_LIST : SHOWN_DIGITS;
        return { cur, unit, systems, digits };
    }
    /** 표의 칸마다: 지금 값과 보이는 자리에서 같은 칸은 지금 값, 다른 칸은 받은 값(모양 — 길이 · 키 — 이 다르면 받은 그대로). 바뀐 것이 없으면 v 그대로 */
    private keepShownCells(k: string, v: unknown, raw: Record<string, unknown>, origin: unknown): unknown {
        const c = this.shownCtx(k, raw, origin);
        if (!c) { return v; }
        let changed = false;
        if (k === 'sections') {
            // 결정 S1: 단면마다(id 가 같은 것), 치수마다 그 단위로 — 보이는 자리에서 같은 치수는 지금 값
            if (!Array.isArray(c.cur) || !Array.isArray(v)) { return v; }
            const units: Record<string, string | null> = DSJ.SECTION_PARAM_UNITS;
            const out = v.map((s: any) => {
                const old = (c.cur as any[]).find((x) => x && s && x.id === s.id && x.template === s.template);
                if (!old || !s || !s.params || !old.params) { return s; }
                const params: Record<string, unknown> = {};
                for (const [p, x] of Object.entries(s.params)) {
                    const o = old.params[p];
                    if (typeof o === 'number' && typeof x === 'number' && o !== x && sameShown(o, x, units[p] ?? null, c.systems, c.digits)) { params[p] = o; changed = true; }
                    else { params[p] = x; }
                }
                return { ...s, params };
            });
            return changed ? out : v;
        }
        const merge = (cur: unknown, x: unknown): unknown => {
            if (typeof cur === 'number' && typeof x === 'number') {
                if (cur !== x && sameShown(cur, x, c.unit, c.systems, c.digits)) { changed = true; return cur; }
                return x;
            }
            if (Array.isArray(cur) && Array.isArray(x) && cur.length === x.length) { return x.map((e, i) => merge(cur[i], e)); }
            if (cur && x && typeof cur === 'object' && typeof x === 'object' && !Array.isArray(cur) && !Array.isArray(x)) {
                const o: Record<string, unknown> = {};
                for (const kk of Object.keys(x as any)) { o[kk] = kk in (cur as any) ? merge((cur as any)[kk], (x as any)[kk]) : (x as any)[kk]; }
                return o;
            }
            return x;
        };
        const out = merge(c.cur, v);
        return changed ? out : v;
    }

    /**
     * B1: 화면이 알린 변경에서 「지금 값과 화면이 적는 자리에서 같은」 수를 뺀다(모든 출처 — 사람이 볼 수 있는 자리 너머의 차이는 화면이
     * 상태를 그리고 다시 읽은 왕복의 꼬리다). 그 키는 상태 · 출처 · 판 · 기록을 바꾸지 않는다. 거울 칸은 그 주인이 같은 변경에 있으면
     * 뺀다(applyChanges 도 그때 거울을 쓰지 않는다 — 주인을 뺀 뒤 거울이 주인을 대신 쓰지 않게). 다른 수는 받은 그대로 둔다.
     */
    private dropShownSame(changes: unknown, origin: unknown): unknown {
        if (!changes || typeof changes !== 'object') { return changes; }
        const raw = changes as Record<string, unknown>;
        const DS = require('../../webview/js/designState');
        const out: Record<string, unknown> = {};
        let dropped = false;
        for (const k of Object.keys(raw)) {
            const m = DS.fieldMeta(k);
            const echo = (m && m.owner === 'mirror' && (m.mirrorOf in raw)) || this.shownSameAsState(k, raw, origin);
            // 수 · 수의 표만(선택 · 체크 · 글 · 빈 칸은 전처럼 — 같은 값이면 applyChanges 가 아무것도 쓰지 않는다)
            const v = raw[k];
            if (echo && (typeof v === 'number' || (v !== null && typeof v === 'object'))) { dropped = true; continue; }
            // 표(경간 · 랩 길이 · 쉼표 목록)의 한 칸만 바뀌었으면 — 바뀌지 않은 칸은 지금 값 그대로(왕복의 꼬리를 함께 쓰지 않게), 바뀐 칸은 받은 그대로
            if (v !== null && typeof v === 'object') {
                const merged = this.keepShownCells(k, v, raw, origin);
                if (merged !== v) { dropped = true; out[k] = merged; continue; }
            }
            out[k] = v;
        }
        return dropped ? out : changes;
    }
    /** 다시 실은 뒤 사람의 첫 변경 전인가(그동안의 화면 연동은 편집이 아니다 — 아래 edit 의 규칙) */
    get inReloadWindow(): boolean { return this.reloadWindow; }
    /** 파일을 연 바로 뒤 화면의 복원 메아리를 기다리는 동안(origin file · 그 앞의 mirror 의 창 — edit 의 openEcho) */
    get inOpenWindow(): boolean { return this.openEcho; }

    edit(data: any): ApplyResult {
        const d0 = data && typeof data === 'object' ? data : {};
        if (d0.drafts && typeof d0.drafts === 'object') { this.drafts = { ...(this.drafts || {}), ...d0.drafts }; }
        // B1: 지금 값과 화면이 적는 자리에서 같은 수는 새 값이 아니다 — 어느 출처든 상태 · 출처 · 판 · 기록에 닿지 않게 먼저 뺀다
        const kept = this.dropShownSame(d0.changes, d0.origin);
        const d = kept === d0.changes ? d0 : { ...d0, changes: kept };
        const w0 = writerOf(d.origin);
        const writer = w0.writer;
        // 호스트만 주는 표지(화면의 데이터에서는 호스트가 지운다): 메아리 칸은 출처를 그대로, 값을 바꾼 연동 칸은 출처를 mirror 로
        const keepSource = typeof d.__keepSource === 'boolean' ? d.__keepSource : w0.keepSource;
        const opts: { baseRev?: number; keepSource?: boolean } = { keepSource };
        if (d.origin === 'user' && Number.isInteger(d.baseRev)) { opts.baseRev = d.baseRev; }
        // V7-S1: 출처(origin)는 화면이 정한다 — 화면의 연동(mirror)도 그것을 만들 때 본 판(seenRev)으로 충돌 규칙을 건다:
        // 그 판 뒤에 다른 쓰는 이(AI · 파일 …)가 바꾼 키를 옛 화면 값으로 되쓰지 않는다.
        else if ((d.origin === 'mirror' || d.origin === 'unit-toggle') && Number.isInteger(d.seenRev)) { opts.baseRev = d.seenRev; }
        const wasClean = this.state.rev === this.savedRev;
        // 다시 실은 화면(새로 고침 · 다리의 다시 보내기)의 메아리는 편집이 아니다 — 판 · 출처 · 장부 · 무효화가 움직이지 않는다:
        //  - 하중 해석 채우기(origin load-analysis)는 호스트가 **새** 하중 해석을 낸 뒤에만(fillPending). 그 밖(다시 보낸 옛 해석 · 파일의
        //    해석)의 채우기는 받지 않고 충돌로 알린다(호스트가 상태를 다시 보낸다).
        //  - 다시 실은 뒤 사람의 첫 변경(user · unit-toggle) 전까지 화면 연동(mirror)은 아무 키도 바꾸지 못한다 — 화면이 상태를 그리며 낸
        //    차이(빈 선택을 처음 값으로 보이는 것 등)는 상태가 아니다(알리기만, 다시 보내지 않는다 — 고리가 되지 않게).
        if (d.origin === 'user' || d.origin === 'unit-toggle') { this.reloadWindow = false; }
        {
            const raw0: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
            const differs = (k: string) => JSON.stringify(curOf(this.state, k)) !== JSON.stringify(raw0[k]);
            if (d.origin === 'load-analysis' && !this.fillPending) {
                const keys = Object.keys(raw0).filter(differs);
                return { state: this.state, accepted: [], conflicts: keys,
                    rejected: keys.map((key) => ({ key, reason: 'a replayed load-analysis fill (no new load analysis since the page was loaded) — not an edit', reason_code: 'host.case.replayed_fill' })) };
            }
            if (d.origin === 'mirror' && this.reloadWindow) {
                const keys = Object.keys(raw0).filter(differs);
                return { state: this.state, accepted: [], conflicts: [],
                    rejected: keys.map((key) => ({ key, reason: 'the reloaded page drew the state differently — not an edit', reason_code: 'host.case.reload_echo' })) };
            }
        }
        // V7-08: 파일을 연 판(경계)보다 오래된 판을 보고 만든 화면의 변경은 키와 무관하게 받지 않는다 — 열기 전에 친 글자가
        // 새로 연 파일의 값을 덮지 않는다(파일은 「다른 쓰는 이」 — 설계 §3.2). 호출자가 상태를 다시 보낸다(conflicts).
        if (opts.baseRev !== undefined && opts.baseRev < this.boundaryRev) {
            const raw: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
            const keys = Object.keys(raw).filter((k) => JSON.stringify(curOf(this.state, k)) !== JSON.stringify(raw[k]));
            return { state: this.state, accepted: [], conflicts: keys,
                rejected: keys.map((key) => ({ key, reason: `made on rev ${opts.baseRev}, before a file was opened at rev ${this.boundaryRev} — not applied`, reason_code: 'host.case.older_than_open' })) };
        }
        // u33 · V7-S1: 하중 해석에서 채운 값(origin load-analysis)은 그 하중 해석보다 뒤에 사람 · AI · 파일이 쓴 키를 덮지 않는다 —
        // 다시 싣기에 다시 온 옛 loadAnalysisComplete 의 채움은 새 해석이 아니다. 하중 해석이 없으면 그런 키는 하나도 덮지 않는다.
        let changes: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
        const guarded: { key: string; reason: string; reason_code?: string }[] = [];
        if (d.origin === 'load-analysis') {
            const keep: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(changes)) {
                const src = this.state.sources[k];
                const newer = this.loadAnalysisRev === null || (this.state.revs[k] ?? 0) > this.loadAnalysisRev;
                if ((src === 'user' || src === 'ai' || src === 'file') && newer) {
                    guarded.push({ key: k, reason: `set by ${src} after the load analysis — the load-analysis fill does not replace it`, reason_code: 'host.case.guarded_fill' });
                } else { keep[k] = v; }
            }
            changes = keep;
        }
        const r = applyChanges(this.state, changes as any, writer, opts);
        if (guarded.length) { r.rejected.push(...guarded); r.conflicts.push(...guarded.map((g) => g.key)); }
        this.state = r.state;
        // 열기 바로 뒤 화면의 메아리(복원한 값을 화면이 다시 적어 알린 것 — origin file · 그 앞의 mirror)는 사람 · AI 의 변경이 아니다:
        // 저장 안 한 변경의 기준(savedRev)을 그만큼 옮긴다. 화면이 같은 값을 다른 글로 적어도(빈 경간 표의 처음 값 16.40 ft 등)
        // 연 파일이 dirty 가 되지 않는다. 사람 · AI 의 변경이 먼저 오면 메아리를 기다리지 않는다.
        if (this.openEcho) {
            if (d.origin === 'file' || d.origin === 'mirror') {
                if (wasClean) { this.savedRev = this.state.rev; this.dirtySince = null; }
                if (d.origin === 'file') { this.openEcho = false; }
            } else { this.openEcho = false; }
        }
        return r;
    }
    /** V7-08: 마지막으로 파일을 연 판(그보다 오래된 화면의 변경은 받지 않는다) */
    boundaryRev = 0;
    /** V7-07: 연 파일이 적었던 출처 가운데 'file' 로 바꾼 것 — get_case_inputs 가 보여 준다 */
    recordedSources: Record<string, Source> = {};
    /** 열기 뒤 화면의 복원 메아리를 기다리는 중(edit 의 주석) */
    private openEcho = false;
    /** u33: 지금 하중 해석을 얻었을 때의 판(없으면 null) — 호스트가 하중 해석을 쥘 때 noteLoadAnalysis 로 적는다 */
    loadAnalysisRev: number | null = null;
    noteLoadAnalysis(present = true): void { this.loadAnalysisRev = present ? this.state.rev : null; }
    /** 호스트가 **새** 하중 해석을 냈다 — 그 해석의 화면 채우기만 받는다(다시 보낸 옛 해석의 채우기는 아니다) */
    noteFreshLoadAnalysis(): void { this.noteLoadAnalysis(true); this.fillPending = true; }
    /** 화면을 다시 실었다(두 번째 hello · 다시 보내기) — 그 뒤의 채우기 · 연동은 편집이 아니다(사람의 첫 변경까지) */
    pageReloaded(): void { this.fillPending = false; this.reloadWindow = true; }
    /** 새 하중 해석의 채우기를 기다린다 */
    private fillPending = false;
    /** 다시 실은 뒤 사람의 첫 변경 전 */
    private reloadWindow = false;

    /**
     * 화면이 처음 떴다(caseHello {inputs, drafts}) — 처음 값이 표의 처음 값과 같은지 본다(다르면 기록 — 시험이 본다).
     * 반환 true = 두 번째부터(새로 고침): 호출자가 상태를 화면에 다시 보낸다.
     */
    hello(data: any, testMode: boolean): boolean {
        this.hellos += 1;
        if (data && data.drafts && typeof data.drafts === 'object') { this.drafts = { ...data.drafts }; }
        const again = this.hellos > 1;
        if (again) { this.pageReloaded(); }
        if (!testMode || !data || !data.inputs) { return again; }
        const DS = require('../../webview/js/designState');
        const fresh = createCaseState();
        const bad: string[] = [];
        for (const k of DS.KEYS.case) {
            if (JSON.stringify(fresh.inputs[k]) !== JSON.stringify(data.inputs[k])) { bad.push(`${k}: table ${JSON.stringify(fresh.inputs[k])} ≠ page ${JSON.stringify(data.inputs[k])}`); }
        }
        for (const k of SPAN_KEY_LIST) {
            // 옛 화면(경간의 단면 칸이 없다)은 그 키를 알리지 않는다
            if (k === 'spanSections' && !(k in data.inputs)) { continue; }
            if (JSON.stringify((fresh.spans as any)[k]) !== JSON.stringify(data.inputs[k])) { bad.push(`${k}`); }
        }
        if ('sections' in data.inputs && JSON.stringify(fresh.sections) !== JSON.stringify(data.inputs.sections)) { bad.push('sections'); }
        this.helloMismatch = bad;
        return again;
    }

    /** 파일을 열었다 — 상태를 바꾼다. 판은 앞으로만(화면의 baseRev 가 거꾸로 가지 않게): 모든 키의 판 = 새 판. */
    loadFromFile(next: CaseState, keepUnitSystem = false, recordedSources: Record<string, Source> = {}): void {
        const rev = this.state.rev + 1;
        this.boundaryRev = rev;
        this.recordedSources = { ...recordedSources };
        const st = JSON.parse(JSON.stringify(next)) as CaseState;
        // 단위가 적히지 않은 파일(1.0 · 옛 파일)은 화면이 지금 단위 그대로 연다 — 상태도 그대로
        if (keepUnitSystem) { st.view.unitSystem = this.state.view.unitSystem; }
        st.rev = rev;
        for (const k of Object.keys(st.revs)) { st.revs[k] = rev; }
        this.state = st;
        this.openEcho = true;
    }

    /** 저장 · 열기 한 순간의 판과 모델 서명 */
    markSaved(modelSig: string): void { this.savedRev = this.state.rev; this.savedModelSig = modelSig; this.dirtySince = null; }

    /** 저장 안 한 변경: 입력 판이 저장 · 열기 때와 다르거나 모델 서명이 다르다(처음 연 뒤 아무것도 열거나 저장하지 않았으면 처음 상태와 비교) */
    isDirty(modelSig: string): boolean {
        if (this.state.rev !== this.savedRev) { return true; }
        return this.savedModelSig !== null && this.savedModelSig !== modelSig;
    }

    /** 엔진 본문을 만들 문맥 — 화면이 붙어 있으면 화면이 쥔 것, 아니면 모델과 호스트의 결과로 */
    context(model: any, hostDesign: any, hostProps: any): RequestContext {
        const pageSeen = this.drafts !== null;
        return {
            drafts: pageSeen ? (this.drafts as Record<string, InputValue>) : modelDrafts(model),
            props: pageSeen ? this.props : hostProps,
            lastDesign: pageSeen ? this.pageDesign
                : (hostDesign && (Array.isArray(hostDesign.regions) || hostDesign.design_positive !== undefined)
                    ? UTILS.pickGoverningPurlinDesign(hostDesign) : hostDesign),
            purlin: pageSeen ? this.pagePurlin
                : (hostDesign && Array.isArray(hostDesign.regions) ? hostDesign : null),
        };
    }

    /**
     * 본문의 키 가운데 쉼표 목록 칸에서 온 것(src/case/requests.ts 의 조립 — 바꾸면 같이): 화면은 상태를 그 칸에 6 자리로 적는다(designState
     * SHOWN_DIGITS_LIST) — 그 키는 그 칸의 단위 · 6 자리로 견준다. 나머지 키는 단위를 모른다(shownSame 의 unit undefined).
     */
    static readonly BODY_LIST_KEYS: Record<string, string> = { I_span_in4: 'spanIxIn4', brace_points_ft: 'bracePointsFt' };
    static sameBody(pg: any, ho: any): boolean {
        const obj = (x: any) => x && typeof x === 'object' && !Array.isArray(x);
        if (!obj(pg) || !obj(ho)) { return DSJ.shownSame(pg, ho, { strict: true }); }
        const kp = Object.keys(pg), kh = Object.keys(ho);
        if (kp.join('\u0000') !== kh.join('\u0000')) { return false; }
        return kp.every((k) => {
            const lk = CaseKeeper.BODY_LIST_KEYS[k];
            const m = lk ? DSJ.fieldMeta(lk) : null;
            return DSJ.shownSame(pg[k], ho[k], m ? { unit: m.unit || null, digits: SHOWN_DIGITS_LIST, strict: true } : { strict: true });
        });
    }

    /**
     * 시험 모드: 화면이 보낸 본문과 호스트가 상태로 만든 본문을 맞대 적는다. 불변식(B1, 2026-11-25): 엔진 본문은 호스트의 상태(정확한 값)로
     * 만들고, 화면의 칸은 그 값을 화면이 적는 자리로 보인다 — 그래서 같음 = designState.shownSame(strict: 빠진 · 남는 키, 형이 다르면 다르다;
     * 수는 화면이 적는 12 자리에서 — 본문의 키는 단위를 모르므로 US 글 또는 어느 단위 계수의 SI 글에서). 그보다 큰 차이는 다르다.
     */
    compare(what: string, pageData: any, hostData: any): boolean {
        const p = JSON.stringify(pageData === undefined ? null : pageData);
        const h = JSON.stringify(hostData === undefined ? null : hostData);
        const same = p === h || CaseKeeper.sameBody(JSON.parse(p), JSON.parse(h));
        this.shadow.push(same ? { what, same, at: Date.now() } : { what, same, page: p, host: h, at: Date.now() });
        if (this.shadow.length > 200) { this.shadow.shift(); }
        return same;
    }
}
