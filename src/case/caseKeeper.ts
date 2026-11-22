/**
 * K2 — 호스트가 쥔 검토 상태와, 화면 쪽 사정(초안 · 마지막 단면 성질 · 화면이 쥔 마지막 설계 · Lap 결과)의 거울.
 * 순수(vscode 없음) — StcfsdPanel 이 메시지를 넘긴다. 설계: docs/implementation/20261123-k2-design.md §3 · §4.
 *
 * 화면 쪽 거울이 필요한 까닭: 지금 화면의 엔진 본문은 화면이 쥔 것(모델 칸의 초안, lastProps, 화면이 고른 퍼린 지배 구간)에도 기댄다.
 * 호스트가 같은 본문을 만들려면(바이트까지 — §4.3) 같은 것을 알아야 한다. 화면이 받는 메시지를 호스트가 보낼 때 같이 적는다.
 */
import { CaseState, InputValue, Source, applyChanges, createCaseState, ApplyResult, replaceGroup } from './caseState';
import { McpWrite } from './mcpGroups';
import { RequestContext, modelDrafts } from './requests';

const UTILS = require('../../webview/js/utils');

/** 화면의 caseEdit.origin → 상태의 출처 */
function writerOf(origin: unknown): { writer: Source; keepSource: boolean } {
    switch (origin) {
        case 'user': return { writer: 'user', keepSource: false };
        case 'file': return { writer: 'file', keepSource: false };
        case 'load-analysis': return { writer: 'load-analysis', keepSource: false };
        case 'unit-toggle': return { writer: 'mirror', keepSource: true };
        default: return { writer: 'mirror', keepSource: false };
    }
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
        switch (command) {
            case 'propertiesResult': this.props = data; break;
            case 'designResult':
                this.pageDesign = data && data.design_positive ? UTILS.pickGoverningPurlinDesign(data) : data;
                break;
            case 'designPurlinResult': this.pageDesign = UTILS.pickGoverningPurlinDesign(data); break;
            case 'lapConnectionResult': this.pageLap = data; break;
            case 'analysisInvalidated':
            case 'resultsCleared':
                // 화면의 clearStaleResults: 설계 결과는 어느 범위든, Lap 결과도
                this.pageDesign = null; this.pageLap = null; break;
            case 'derivedResultsInvalidated':
                this.onPageInvalidated(data && data.scope);
                break;
            default: break;
        }
    }

    /** 화면이 스스로 결과를 지웠다(invalidateDerivedResults — 화면의 clearStaleResults 와 같은 범위) */
    onPageInvalidated(scope?: unknown): void {
        // D-4(K2-7): 접합부 탭의 범위는 그 결과만 — 'connection' 은 단일 접합(거울 없음), 'lap' 은 Lap 결과만
        if (scope === 'connection') { return; }
        if (scope === 'lap') { this.pageLap = null; return; }
        this.pageDesign = null; this.pageLap = null;
    }

    /**
     * K2-5 결정 1: MCP 설계 도구의 인자를 상태에 쓴다 — 합칠 키(재료 · 설계법 · 부재 유형), 통째로 쓸 묶음(받지 않은 키 null), 경간 표,
     * mcpOnly[도구]. 반환: 사람이 정했던 값 가운데 이번에 바뀐 것(그 전 값 · 출처 — 응답에 싣는다, AI 가 사람에게 알리고 되돌릴 수 있게).
     */
    applyMcp(w: McpWrite): { rev: number; written: string[]; replaced: { key: string; previous: InputValue | any; previous_source: Source }[]; skipped: McpWrite['skipped'] } {
        const before = JSON.parse(JSON.stringify(this.state)) as CaseState;
        let st = applyChanges(this.state, w.merge, 'ai').state;
        st = replaceGroup(st, Object.keys(w.group), w.group, 'ai').state;
        const shapeChanged = st.inputs.spanType !== before.inputs.spanType || st.inputs.nSpans !== before.inputs.nSpans;
        if (w.spans) {
            st = applyChanges(st, { spans: w.spans.spans, supports: w.spans.supports, lapsPerSupport: w.spans.lapsPerSupport }, 'ai').state;
        } else if (shapeChanged) {
            // 경간 유형 · 수만 바뀌었다 — 화면처럼 표를 처음 값으로(buildSpanTable)
            const DS = require('../../webview/js/designState');
            const t = DS.defaultSpanTable(String(st.inputs.spanType), Number(st.inputs.nSpans));
            const rev = st.rev;
            for (const k of ['spans', 'supports', 'lapsPerSupport'] as const) {
                if (JSON.stringify((st.spans as any)[k]) !== JSON.stringify(t[k])) { (st.spans as any)[k] = t[k]; st.sources[k] = 'ai'; st.revs[k] = rev; }
            }
        }
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
        for (const k of ['spans', 'supports', 'lapsPerSupport'] as const) {
            if (JSON.stringify((st.spans as any)[k]) === JSON.stringify((before.spans as any)[k])) { continue; }
            written.push(k);
            if (person.includes(before.sources[k])) { replaced.push({ key: k, previous: (before.spans as any)[k], previous_source: before.sources[k] }); }
        }
        if (written.length && st.rev === before.rev) { st.rev = before.rev + 1; }
        this.state = st;
        return { rev: st.rev, written, replaced, skipped: w.skipped };
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

    edit(data: any): ApplyResult {
        const d = data && typeof data === 'object' ? data : {};
        if (d.drafts && typeof d.drafts === 'object') { this.drafts = { ...(this.drafts || {}), ...d.drafts }; }
        const { writer, keepSource } = writerOf(d.origin);
        const opts: { baseRev?: number; keepSource?: boolean } = { keepSource };
        if (d.origin === 'user' && Number.isInteger(d.baseRev)) { opts.baseRev = d.baseRev; }
        const r = applyChanges(this.state, d.changes || {}, writer, opts);
        this.state = r.state;
        return r;
    }

    /**
     * 화면이 처음 떴다(caseHello {inputs, drafts}) — 처음 값이 표의 처음 값과 같은지 본다(다르면 기록 — 시험이 본다).
     * 반환 true = 두 번째부터(새로 고침): 호출자가 상태를 화면에 다시 보낸다.
     */
    hello(data: any, testMode: boolean): boolean {
        this.hellos += 1;
        if (data && data.drafts && typeof data.drafts === 'object') { this.drafts = { ...data.drafts }; }
        const again = this.hellos > 1;
        if (!testMode || !data || !data.inputs) { return again; }
        const DS = require('../../webview/js/designState');
        const fresh = createCaseState();
        const bad: string[] = [];
        for (const k of DS.KEYS.case) {
            if (JSON.stringify(fresh.inputs[k]) !== JSON.stringify(data.inputs[k])) { bad.push(`${k}: table ${JSON.stringify(fresh.inputs[k])} ≠ page ${JSON.stringify(data.inputs[k])}`); }
        }
        for (const k of ['spans', 'supports', 'lapsPerSupport'] as const) {
            if (JSON.stringify((fresh.spans as any)[k]) !== JSON.stringify(data.inputs[k])) { bad.push(`${k}`); }
        }
        this.helloMismatch = bad;
        return again;
    }

    /** 파일을 열었다 — 상태를 바꾼다. 판은 앞으로만(화면의 baseRev 가 거꾸로 가지 않게): 모든 키의 판 = 새 판. */
    loadFromFile(next: CaseState, keepUnitSystem = false): void {
        const rev = this.state.rev + 1;
        const st = JSON.parse(JSON.stringify(next)) as CaseState;
        // 단위가 적히지 않은 파일(1.0 · 옛 파일)은 화면이 지금 단위 그대로 연다 — 상태도 그대로
        if (keepUnitSystem) { st.view.unitSystem = this.state.view.unitSystem; }
        st.rev = rev;
        for (const k of Object.keys(st.revs)) { st.revs[k] = rev; }
        this.state = st;
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
        };
    }

    /** 시험 모드: 화면이 보낸 본문과 호스트가 상태로 만든 본문을 맞대 적는다 */
    compare(what: string, pageData: any, hostData: any): boolean {
        const p = JSON.stringify(pageData === undefined ? null : pageData);
        const h = JSON.stringify(hostData === undefined ? null : hostData);
        const same = p === h;
        this.shadow.push(same ? { what, same, at: Date.now() } : { what, same, page: p, host: h, at: Date.now() });
        if (this.shadow.length > 200) { this.shadow.shift(); }
        return same;
    }
}
