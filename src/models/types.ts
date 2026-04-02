/**
 * CUFSM TypeScript 타입 정의
 *
 * Python models/data.py와 1:1 대응
 * 참조: 컨버전전략.md §3 메시지 프로토콜
 */

export interface CufsmModel {
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
    /** 종방향 항 (길이별) */
    m_all: number[][];
    /** cFSM 설정 */
    GBTcon: GBTConfig;
    /** 고유치 수 */
    neigs: number;
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

export interface CufsmResult {
    /** 좌굴 곡선 — curve[i] = [length, lf1, lf2, ...] */
    curve: number[][];
    /** 길이 수 */
    n_lengths: number;
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
}

/** 기본 모델 생성 */
export function createDefaultModel(): CufsmModel {
    return {
        prop: [[100, 29500, 29500, 0.3, 0.3, 11346.15]],
        node: [],
        elem: [],
        lengths: [],
        springs: [],
        constraints: [],
        BC: 'S-S',
        m_all: [],
        GBTcon: {
            glob: [], dist: [], local: [], other: [],
            ospace: 1, orth: 1, couple: 1, norm: 0,
        },
        neigs: 20,
    };
}
