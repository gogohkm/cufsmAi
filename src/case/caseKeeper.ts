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
        // V7-S1: 출처(origin)는 화면이 정한다 — 화면의 연동(mirror)도 그것을 만들 때 본 판(seenRev)으로 충돌 규칙을 건다:
        // 그 판 뒤에 다른 쓰는 이(AI · 파일 …)가 바꾼 키를 옛 화면 값으로 되쓰지 않는다.
        else if (d.origin === 'mirror' && Number.isInteger(d.seenRev)) { opts.baseRev = d.seenRev; }
        const wasClean = this.state.rev === this.savedRev;
        // 다시 실은 화면(새로 고침 · 다리의 다시 보내기)의 메아리는 편집이 아니다 — 판 · 출처 · 장부 · 무효화가 움직이지 않는다:
        //  - 하중 해석 채우기(origin load-analysis)는 호스트가 **새** 하중 해석을 낸 뒤에만(fillPending). 그 밖(다시 보낸 옛 해석 · 파일의
        //    해석)의 채우기는 받지 않고 충돌로 알린다(호스트가 상태를 다시 보낸다).
        //  - 다시 실은 뒤 사람의 첫 변경(user · unit-toggle) 전까지 화면 연동(mirror)은 아무 키도 바꾸지 못한다 — 화면이 상태를 그리며 낸
        //    차이(빈 선택을 처음 값으로 보이는 것 등)는 상태가 아니다(알리기만, 다시 보내지 않는다 — 고리가 되지 않게).
        if (d.origin === 'user' || d.origin === 'unit-toggle') { this.reloadWindow = false; }
        {
            const raw0: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
            const differs = (k: string) => {
                const cur = (['spans', 'supports', 'lapsPerSupport'] as string[]).includes(k) ? (this.state.spans as any)[k] : this.state.inputs[k];
                return JSON.stringify(cur) !== JSON.stringify(raw0[k]);
            };
            if (d.origin === 'load-analysis' && !this.fillPending) {
                const keys = Object.keys(raw0).filter(differs);
                return { state: this.state, accepted: [], conflicts: keys,
                    rejected: keys.map((key) => ({ key, reason: 'a replayed load-analysis fill (no new load analysis since the page was loaded) — not an edit' })) };
            }
            if (d.origin === 'mirror' && this.reloadWindow) {
                const keys = Object.keys(raw0).filter(differs);
                return { state: this.state, accepted: [], conflicts: [],
                    rejected: keys.map((key) => ({ key, reason: 'the reloaded page drew the state differently — not an edit' })) };
            }
        }
        // V7-08: 파일을 연 판(경계)보다 오래된 판을 보고 만든 화면의 변경은 키와 무관하게 받지 않는다 — 열기 전에 친 글자가
        // 새로 연 파일의 값을 덮지 않는다(파일은 「다른 쓰는 이」 — 설계 §3.2). 호출자가 상태를 다시 보낸다(conflicts).
        if (opts.baseRev !== undefined && opts.baseRev < this.boundaryRev) {
            const raw: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
            const keys = Object.keys(raw).filter((k) => {
                const cur = (['spans', 'supports', 'lapsPerSupport'] as string[]).includes(k) ? (this.state.spans as any)[k] : this.state.inputs[k];
                return JSON.stringify(cur) !== JSON.stringify(raw[k]);
            });
            return { state: this.state, accepted: [], conflicts: keys,
                rejected: keys.map((key) => ({ key, reason: `made on rev ${opts.baseRev}, before a file was opened at rev ${this.boundaryRev} — not applied` })) };
        }
        // u33 · V7-S1: 하중 해석에서 채운 값(origin load-analysis)은 그 하중 해석보다 뒤에 사람 · AI · 파일이 쓴 키를 덮지 않는다 —
        // 다시 싣기에 다시 온 옛 loadAnalysisComplete 의 채움은 새 해석이 아니다. 하중 해석이 없으면 그런 키는 하나도 덮지 않는다.
        let changes: Record<string, unknown> = d.changes && typeof d.changes === 'object' ? d.changes : {};
        const guarded: { key: string; reason: string }[] = [];
        if (d.origin === 'load-analysis') {
            const keep: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(changes)) {
                const src = this.state.sources[k];
                const newer = this.loadAnalysisRev === null || (this.state.revs[k] ?? 0) > this.loadAnalysisRev;
                if ((src === 'user' || src === 'ai' || src === 'file') && newer) {
                    guarded.push({ key: k, reason: `set by ${src} after the load analysis — the load-analysis fill does not replace it` });
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
        for (const k of ['spans', 'supports', 'lapsPerSupport'] as const) {
            if (JSON.stringify((fresh.spans as any)[k]) !== JSON.stringify(data.inputs[k])) { bad.push(`${k}`); }
        }
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
