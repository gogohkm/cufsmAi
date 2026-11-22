/**
 * K2 — 호스트가 쥔 검토 상태와, 화면 쪽 사정(초안 · 마지막 단면 성질 · 화면이 쥔 마지막 설계 · Lap 결과)의 거울.
 * 순수(vscode 없음) — StcfsdPanel 이 메시지를 넘긴다. 설계: docs/implementation/20261123-k2-design.md §3 · §4.
 *
 * 화면 쪽 거울이 필요한 까닭: 지금 화면의 엔진 본문은 화면이 쥔 것(모델 칸의 초안, lastProps, 화면이 고른 퍼린 지배 구간)에도 기댄다.
 * 호스트가 같은 본문을 만들려면(바이트까지 — §4.3) 같은 것을 알아야 한다. 화면이 받는 메시지를 호스트가 보낼 때 같이 적는다.
 */
import { CaseState, InputValue, Source, applyChanges, createCaseState, ApplyResult } from './caseState';
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
            case 'derivedResultsInvalidated':
                // 화면의 clearStaleResults: 설계 결과는 어느 범위든, Lap 결과도
                this.pageDesign = null; this.pageLap = null; break;
            default: break;
        }
    }

    /** 화면이 스스로 결과를 지웠다(invalidateDerivedResults — 화면의 clearStaleResults 와 같은 범위) */
    onPageInvalidated(): void { this.pageDesign = null; this.pageLap = null; }

    /** 화면의 caseEdit {origin, changes, drafts?, baseRev?} */
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
    markSaved(modelSig: string): void { this.savedRev = this.state.rev; this.savedModelSig = modelSig; }

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
