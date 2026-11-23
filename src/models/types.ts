/**
 * CUFSM TypeScript 타입 정의
 *
 * Python models/data.py와 1:1 대응
 * 참조: 컨버전전략.md §3 메시지 프로토콜
 */

export interface StcfsdModel {
    /** 재료 물성 [matnum, Ex, Ey, vx, vy, G] */
    prop: number[][];
    /** 절점 [node#, x, z, dofx, dofz, dofy, dofrot, stress] */
    node: number[][];
    /** 요소 [elem#, nodei, nodej, t, matnum] */
    elem: number[][];
    /** 해석 길이 배열 */
    lengths: number[];
    /** 스프링 데이터 */
    springs: number[][];
    /** 구속조건 */
    constraints: number[][];
    /** 경계조건 */
    BC: string;
    /** 종방향 항 (길이별). 'auto' = 서버가 BC 에 따라 고름(S-S → [1], 그 밖 → m_recommend). */
    m_all: number[][] | 'auto';
    /** cFSM 설정 */
    GBTcon: GBTConfig;
    /** 고유치 수 */
    neigs: number;
    /** 호스트 메타데이터 (서버는 읽지 않음) */
    loadCase?: string;
    loadFy?: number;
    /** custom 하중 경우의 P · Mxx · Mzz (US) — 화면 칸 동기화용 */
    loadValues?: { P: number; Mxx: number; Mzz: number };
    sectionType?: string;
    sectionTemplate?: string;
    sectionParams?: Record<string, any>;
    cornerRadius?: number;
    /** K4a: 템플릿 단면의 요소 자리(엔진 element_roles, 요소 순서). 손으로 만든 단면 · 절점/요소 편집 뒤에는 없다 */
    elementRoles?: string[];
    /** K4a: 템플릿으로 만든 뒤 절점 · 요소를 손으로 고쳤다(템플릿 치수가 더는 단면 전체를 말하지 않는다) */
    sectionEdited?: boolean;
}

export interface GBTConfig {
    glob: number[];
    dist: number[];
    local: number[];
    other: number[];
    ospace: number;
    orth: number;
    couple: number;
    norm: number;
}

export interface StcfsdResult {
    /** 좌굴 곡선 — curve[i] = [length, lf1, lf2, ...] */
    curve: number[][];
    /** 모드형상 */
    shapes?: any[][];
    /** 길이 수 */
    n_lengths: number;
    /** protocol_version 2: 곡선·shapes·m_all 이 실제로 담고 있는 길이(폐기 길이 제외) */
    lengths?: number[];
    length_indices?: number[];
    lengths_requested?: number[];
    discarded_lengths?: number[];
    /** 실제로 쓴 종방향 항 */
    m_all?: number[][];
    m_all_selection?: any;
    diagnostics?: any[];
    warnings?: string[];
    success?: boolean;
}

export interface SectionProperties {
    A: number;
    xcg: number;
    zcg: number;
    Ixx: number;
    Izz: number;
    Ixz: number;
    thetap: number;
    I11: number;
    I22: number;
}

/**
 * K4a: 무효가 된 결과의 장부 한 줄(호스트 StcfsdPanel). 호스트는 낡은 결과를 지운다(낡은 수를 최신으로 내지 않는다) —
 * 이 줄은 「무엇이 · 왜 · 언제 · 어떤 입력 변화로」 지워졌는지만 남긴다. 그 종류의 새 결과가 오면 줄이 지워진다.
 */
export type LedgerKind = 'buckling_analysis' | 'design_dsm' | 'load_analysis' | 'member_design' | 'lap' | 'connection' | 'validation';

export interface LedgerEntry {
    kind: LedgerKind;
    /** 접합 결과마다의 id(connection-<n>) — 그 밖에는 없다 */
    id?: string;
    /** member_design: 지워진 결과의 종류(compression · flexure · combined · tension · purlin) */
    result_type?: string;
    /** 호스트의 까닭 글(영문 — 웹뷰의 _reasonKo 가 옮긴다) */
    reason: string;
    /** 그 무효를 일으킨 것: 호스트 액션 이름(MCP 와 화면이 같은 이름) 또는 웹뷰 메시지 이름, 바뀐 입력 */
    cause: { action?: string; message?: string; scope?: string; inputs?: string[] };
    invalidated_at: string;
    /** 지워진 결과가 만들어진 시각(알면) */
    result_at: string | null;
}

/**
 * K4a: 화면이 알린 「지금 보는 것」(webview → host `viewReport` 메시지 또는 호스트 액션 `report_view`).
 * 계약: docs/implementation/20261123-view-contract.md
 */
export interface ViewItem {
    kind: 'check' | 'model' | 'result' | 'validation' | 'record';
    id: string;
    /** record: 기록의 종류 — change(변경 묶음) · work(업무 항목) · assumption(가정) · source(원자료) · alternative(대안) */
    type?: string;
    /** check: 그 항목이 든 결과 — member · purlin · connection · lap */
    scope?: string;
    /** check: design_checks[].location 과 같은 값(퍼린은 {region, check_point}) */
    location?: any;
}

export interface ViewReport {
    screen: string;
    view: string | null;
    selection: ViewItem | null;
    /** 이 화면이 AI 의 focus 를 따라가는가(「AI 따라가기」). 모르면 null */
    follows_focus: boolean | null;
    /** 'person' = 사람이 고른 것, 'program' = 화면이 스스로 옮긴 것, 'focus' = AI 의 focus 를 따라간 것 */
    by: string | null;
    reported_at: string;
}

export interface FocusRecord {
    request_id: string;
    item: ViewItem;
    reason: string | null;
    requested_at: string;
    forwarded: boolean;
    target_found: boolean | null;
    /** 화면이 그 요청에 답한 것(viewReport 의 focus_response) — 따라갔는지 · 거절했는지 */
    response: { screen: string; followed: boolean; note: string | null; at: string } | null;
}

/** WebView → Extension Host 메시지 */
export interface WebviewToExtMessage {
    command: string;
    data?: any;
}

/** Extension Host → WebView 메시지 */
export interface ExtToWebviewMessage {
    command: string;
    data?: any;
    error?: string;
}

/** JSON-RPC 요청 */
export interface JsonRpcRequest {
    method: string;
    params: any;
    id: number;
}

/** JSON-RPC 응답 */
export interface JsonRpcResponse {
    id: number;
    result?: any;
    error?: string;
    /** protocol_version 2: PARSE_ERROR · INVALID_REQUEST · INVALID_PARAMS · METHOD_NOT_FOUND · ENGINE_ERROR · ... */
    error_code?: string;
}

/** 기본 모델 생성 */
export function createDefaultModel(): StcfsdModel {
    return {
        prop: [[100, 29500, 29500, 0.3, 0.3, 11300]],
        node: [],
        elem: [],
        lengths: [],
        springs: [],
        constraints: [],
        BC: 'S-S',
        m_all: 'auto',
        // CUFSM 기본 기저(orth 2 · norm 1) — 엔진 GBTConfig 기본과 같게(F2/F3 후속).
        GBTcon: {
            glob: [], dist: [], local: [], other: [],
            ospace: 1, orth: 2, couple: 1, norm: 1,
        },
        neigs: 10,
    };
}
