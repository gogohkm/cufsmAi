// 0926 Phase 1 (P1-7): SI↔US 단위 변환 단일 진실 공급원.
//
// 기존에는 각 aisi_design_* 도구가 SI 입출력 맵을 수기로 관리하여
// 키 누락 시 단위 혼합 출력이 가능했다. 모든 변환 상수·함수·도구별
// 출력 맵을 이 모듈로 모으고, test/webview/si_units_roundtrip.js로 잠근다.
//
// VS Code API에 의존하지 않으므로 node 테스트에서 직접 로드 가능하다.

export const SI_TO_US = {
    length: 1 / 25.4,          // mm → in
    area: 1 / (25.4 * 25.4),   // mm² → in²
    stress: 1 / 6.89476,       // MPa → ksi
    force: 1 / 4.44822,        // kN → kips
    moment: 1 / 0.11298,       // kN-m → kip-in
    pressure: 1 / 0.04788,     // kPa → psf
    linload: 1 / 0.01459,      // kN/m → plf
    length_ft: 1 / 0.3048,     // m → ft
};

export const US_TO_SI = {
    length: 25.4,
    area: 25.4 * 25.4,
    stress: 6.89476,
    force: 4.44822,
    moment: 0.11298,
    pressure: 0.04788,
    linload: 0.01459,
    length_ft: 0.3048,
};

export type UnitKey = keyof typeof SI_TO_US;

/** 지정된 키의 값을 SI→US로 변환 (입력용, 반올림 없음) */
export function convertInputSI(
    params: Record<string, any>,
    mapping: Record<string, UnitKey>
): Record<string, any> {
    const out = { ...params };
    for (const [key, unitType] of Object.entries(mapping)) {
        if (out[key] != null && typeof out[key] === 'number') {
            out[key] = out[key] * SI_TO_US[unitType];
        }
    }
    return out;
}

/** 결과 dict의 지정 키를 US→SI로 변환 (출력용, 소수 4자리) */
export function convertOutputSI(
    result: Record<string, any>,
    mapping: Record<string, UnitKey>
): Record<string, any> {
    const out = { ...result };
    for (const [key, unitType] of Object.entries(mapping)) {
        if (out[key] != null && typeof out[key] === 'number') {
            out[key] = Math.round(out[key] * US_TO_SI[unitType] * 1e4) / 1e4;
        }
    }
    return out;
}

// ============================================================
// 도구별 SI 출력 맵 (Python 엔진 US 반환 → SI 역변환 키)
// 무차원 키(utilization/pass/ratio/equation 등)는 의도적으로 제외.
// ============================================================

/** aisi_design_compression 출력 (US kips → SI kN) */
export const SI_OUTPUT_COMPRESSION: Record<string, UnitKey> = {
    Pne: 'force', Pnl: 'force', Pnd: 'force', Py: 'force',
    Pn: 'force', phi_Pn: 'force', Pn_omega: 'force',
    design_strength: 'force',
};

/** aisi_design_flexure 출력 (US kip-in → SI kN-m) */
export const SI_OUTPUT_FLEXURE: Record<string, UnitKey> = {
    Mne: 'moment', Mnl: 'moment', Mnd: 'moment', My: 'moment',
    Mn: 'moment', Mn_dsm: 'moment', phi_Mn: 'moment', Mn_omega: 'moment',
    design_strength: 'moment',
};

/** aisi_design_connection 출력 (US kips → SI kN, 최상위 키만) */
export const SI_OUTPUT_CONNECTION: Record<string, UnitKey> = {
    Rn: 'force', design_strength: 'force',
};

/** aisi_design_connection SI 입력 맵 */
export const SI_INPUT_CONNECTION: Record<string, UnitKey> = {
    Fy: 'stress', Fu: 'stress', Fub: 'stress', Fxx: 'stress', Fuf: 'stress',
    t1: 'length', t2: 'length', d: 'length', e: 'length', s: 'length',
    weld_length: 'length', weld_size: 'length', da: 'length',
    width: 'length', g: 'length', s_pitch: 'length', Ag: 'area',
    Pu: 'force', Vu: 'force', Tu: 'force',
};
