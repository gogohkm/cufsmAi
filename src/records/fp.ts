/**
 * 기록(R1-1) · 지문 — 설계 §2.3. 기록은 계산하지 않는다 — 입력 · 결과 · 엔진을 지문으로 가리킬 뿐이다.
 *
 *  - modelFp: 호스트가 「결과가 지금 모델의 것인가」를 가르는 필드(`StcfsdPanel._modelSignature`)와 같은 필드 +
 *    템플릿 · 치수. 필드 목록은 `MODEL_SIGNATURE_FIELDS` — 시험이 패널 소스의 `_modelSignature` 와 대조한다.
 *  - engineId 는 여기서 계산하지 않는다. 파이썬 서버의 `selftest.engine_id`(엔진 소스의 sha256)를 받아
 *    `normalizeEngineId` 로 꼴만 맞춘다(오케스트레이터 결정 — 해시를 두 곳에서 만들지 않는다).
 * VS Code 를 쓰지 않는다. 파일을 읽거나 쓰지 않는다.
 */
import { canonicalJson, fp, sha256Hex } from './canonical';

export const NS = {
    model: 'stcfsd-fp/model/1',
    recordModel: 'stcfsd-fp/record-model/2',
    case: 'stcfsd-fp/case/1',
    content: 'stcfsd-fp/content/1',
    request: 'stcfsd-fp/request/1',
    result: 'stcfsd-fp/result/1',
    check: 'stcfsd-fp/check/1',
    location: 'stcfsd-fp/location/1',
    group: 'stcfsd-fp/group/1',
    doc: 'stcfsd-fp/doc/1',
    register: 'stcfsd-fp/register/1',
} as const;

/** `StcfsdPanel._modelSignature` 가 보는 필드(차례 그대로)와 그 기본값 */
export const MODEL_SIGNATURE_FIELDS = [
    'prop', 'node', 'elem', 'lengths', 'springs', 'constraints', 'BC', 'm_all', 'GBTcon', 'neigs', 'loadCase', 'loadFy',
] as const;

/** 패널의 `_getAnalysisFy` 와 같은 규칙: loadFy 가 양수면 그것, 아니면 절점 응력(8째 칸)의 최대 |값| */
export function analysisFy(model: any): number {
    const fy = Number(model?.loadFy);
    if (Number.isFinite(fy) && fy > 0) { return fy; }
    return Math.max(...((model?.node || []) as any[]).map((n: any) => Math.abs((Array.isArray(n) ? n[7] : 0) || 0)), 0);
}

/** 모델 서명의 투영 — 패널의 `_modelSignature` 와 같은 값(기본값까지) */
export function modelSignatureProjection(model: any): Record<string, unknown> {
    const m = model || {};
    const value = (key: string, fallback: any) => m[key] ?? fallback;
    return {
        prop: m.prop || [], node: m.node || [], elem: m.elem || [], lengths: m.lengths || [],
        springs: value('springs', []), constraints: value('constraints', []), BC: m.BC || 'S-S', m_all: m.m_all || [],
        GBTcon: value('GBTcon', {}), neigs: Number(value('neigs', 10)), loadCase: value('loadCase', 'unknown'),
        loadFy: Number(value('loadFy', analysisFy(m))),
    };
}

export function modelFp(model: any): string {
    const m = model || {};
    return fp(NS.model, {
        sig: modelSignatureProjection(m),
        sectionTemplate: m.sectionTemplate ?? null,
        sectionParams: m.sectionParams && typeof m.sectionParams === 'object' ? m.sectionParams : null,
    });
}

/**
 * S4(V9b): 기록의 모델 지문 — modelFp 의 모든 것 + 서명 밖이지만 엔진 요청에 닿는 칸(템플릿이 없는 모델의 `sectionType` · `cornerRadius`,
 * 요소 자리 `elementRoles`). 봉인(resultSeal)은 저장한 모델 전부를 따로 지문으로 하므로(V8-03) 그 모델 지문(modelFp)은 바꾸지 않는다 —
 * 바꾸면 이미 저장한 파일의 결과가 다시 열 때 되살아나지 않는다. 기록(내용 지문 — 초안 · 발행의 근거 · 실행 줄 · 변경 묶음 · 대안)은 이것을 쓴다.
 */
export function recordModelFp(model: any): string {
    const m = model || {};
    return fp(NS.recordModel, { model: modelFp(m), sectionType: m.sectionType ?? null, cornerRadius: m.cornerRadius ?? null,
        elementRoles: Array.isArray(m.elementRoles) ? m.elementRoles : null });
}

/** 검토 입력의 지문 — inputs · spans · mcpOnly 만(출처 · 판 · 보기는 뺀다) */
export function caseFp(state: { inputs?: unknown; spans?: unknown; mcpOnly?: unknown; sections?: unknown } | null | undefined): string {
    const s = state || {};
    // 2026-11-28 결정 S1: 경간의 단면 · 단면 목록은 쓸 때만 지문에 든다 — 모든 경간 S1 · 빈 목록이면 이 기능이 없던 때와 같은 지문
    // (기록에 남은 지문 · 봉인이 그대로 맞는다)
    const sp: any = s.spans && typeof s.spans === 'object' ? s.spans : null;
    const allS1 = !sp || !Array.isArray(sp.spanSections) || sp.spanSections.every((x: unknown) => x === 'S1');
    const secs = Array.isArray(s.sections) && s.sections.length ? s.sections : null;
    const spans = sp && allS1 && 'spanSections' in sp ? (({ spanSections: _x, ...rest }) => rest)(sp) : (s.spans ?? null);
    return fp(NS.case, { inputs: s.inputs ?? {}, spans, mcpOnly: s.mcpOnly ?? {}, ...(secs || !allS1 ? { sections: secs ?? [] } : {}) });
}

export function contentFp(model: any, state: { inputs?: unknown; spans?: unknown; mcpOnly?: unknown } | null | undefined): {
    contentFp: string; modelFp: string; caseFp: string;
} {
    const m = recordModelFp(model);
    const c = caseFp(state);
    return { contentFp: fp(NS.content, { modelFp: m, caseFp: c }), modelFp: m, caseFp: c };
}

/** 엔진에 보낸 요청 **바이트**(글 그대로)의 지문 */
export function requestFp(requestText: string | Buffer): string {
    return fp(NS.request, sha256Hex(requestText));
}

/** 결과의 지문 — 만든 시각(`_meta.timestamp`, 맨 위 `timestamp` · `at`)만 뺀다 */
export function resultFp(result: unknown): string {
    let r: any = result;
    if (r && typeof r === 'object' && !Array.isArray(r)) {
        r = { ...r };
        delete r.timestamp;
        delete r.at;
        if (r._meta && typeof r._meta === 'object' && !Array.isArray(r._meta)) {
            const meta = { ...r._meta };
            delete meta.timestamp;
            r._meta = meta;
        }
    }
    return fp(NS.result, r ?? null);
}

export interface CheckRef { scope: string; id: string; location?: unknown; combination?: string | null }

/** 검토 열쇠 — `<범위>|<id>|<fp(location)>|<조합 또는 ''>` */
export function checkKey(c: CheckRef): string {
    const loc = c.location === undefined ? null : c.location;
    return `${c.scope}|${c.id}|${fp(NS.location, loc)}|${c.combination ?? ''}`;
}

/** 검토 항목 하나(design_checks 의 항목 통째 — 계산 과정 포함)의 지문 */
export function checkFp(item: unknown): string { return fp(NS.check, item ?? null); }

/** 입력 묶음(단면 · 재료 · 표의 group)의 값 */
export function groupFp(group: string, values: Record<string, unknown>): string { return fp(NS.group, { group, values }); }

/** ReportDoc 의 지문 — `meta.created` · `meta.stamp` 는 뺀다(도장만 바뀐 발행본은 같은 자료) */
export function docFp(doc: any): string {
    let d = doc;
    if (d && typeof d === 'object' && d.meta && typeof d.meta === 'object') {
        const meta = { ...d.meta };
        delete meta.created;
        delete meta.stamp;
        d = { ...d, meta };
    }
    return fp(NS.doc, d ?? null);
}

/** 그 순간의 가정 · 업무 · 확인을 접은 것의 지문 */
export function registerFp(folded: unknown): string { return fp(NS.register, folded ?? null); }

const ENGINE_ID_RE = /^(?:sha256:)?([0-9a-f]{64})$/;
/** 파이썬 `selftest.engine_id` → `sha256:<hex>`. 꼴이 틀리면 null(지어내지 않는다) */
export function normalizeEngineId(raw: unknown): string | null {
    if (typeof raw !== 'string') { return null; }
    const m = ENGINE_ID_RE.exec(raw.trim().toLowerCase());
    return m ? `sha256:${m[1]}` : null;
}

/** 시험 · 디버그용 — 지문을 만든 정규 JSON(바이트) */
export function fingerprintPayload(ns: string, v: unknown): string { return canonicalJson({ ns, v }); }
