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
