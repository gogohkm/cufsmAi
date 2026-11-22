// SI↔US 단위 변환 — MCP 도구의 단일 진실 공급원 (0926 P1-7, 2026-11-22 W2: R8-04 · R8-12 · R8-01).
//
// 원칙
// - 엔진 내부는 US(in, kip, ksi, kip-in; 하중 해석은 ft · plf · kip-ft). SI 는 MCP 경계에서만 바꾼다.
// - 계수는 정의값에서 유도한다(1 lbf = 0.45359237 kg × 9.80665 m/s², 1 in = 25.4 mm, 1 ft = 0.3048 m).
// - 입력은 SI 값을 계수로 **나누고** 15 자리로 맞춘다 → US 로 정확히 표현되는 값(12.7 mm → 0.5 in)이
//   그대로 엔진에 간다(경계 비교가 뒤집히지 않음). US 호출은 아무 값도 건드리지 않는다.
// - 출력은 계수를 곱할 뿐 반올림하지 않는다(왕복 오차 없음).
// - 출력 변환은 키 이름 → 단위 표 하나로, 중첩 dict · 배열 · 한계상태 표 · steps[] 까지 재귀로 한다.
//   표에 없는 수치 키는 바꾸지 않고 경로를 `si_unconverted` 로 돌려준다(조용히 섞이지 않게).
// - 엔진이 쓴 글(report, steps[].formula, warnings, assumptions …)은 US 그대로 두고 US 라고 밝힌다.
//
// VS Code API 에 의존하지 않으므로 node 시험에서 직접 로드한다(test/webview/si_units_roundtrip.js).

const KIP_KN = 4.4482216152605;          // 1 kip = 4.4482216152605 kN (정의값)
const IN_MM = 25.4;                      // 1 in = 25.4 mm (정의값)
const IN_M = 0.0254;
const FT_M = 0.3048;

/** US 값 × US_TO_SI[unit] = SI 값. 키 이름은 단위 종류. */
export const US_TO_SI = {
    length: IN_MM,                              // in → mm
    area: IN_MM * IN_MM,                        // in² → mm²
    modulus: IN_MM ** 3,                        // in³ → mm³
    inertia: IN_MM ** 4,                        // in⁴ → mm⁴
    warping: IN_MM ** 6,                        // in⁶ → mm⁶
    stress: KIP_KN * 1000 / (IN_MM * IN_MM),    // ksi → MPa (6.894757293168361)
    force: KIP_KN,                              // kips → kN
    moment: KIP_KN * IN_M,                      // kip-in → kN·m (0.1129848290276167)
    moment_ft: KIP_KN * FT_M,                   // kip-ft → kN·m
    length_ft: FT_M,                            // ft → m
    linload: KIP_KN / 1000 / FT_M,              // plf (lb/ft) → kN/m
    pressure: KIP_KN / 1000 / (FT_M * FT_M),    // psf → kPa
    density: KIP_KN * 1000 / IN_M / IN_M ** 3,  // kip·s²/in⁴ → kg/m³ (7.345e-7 → 7849)
    rot_stiff: KIP_KN,                          // kip·in/rad/in → kN·m/rad/m
    lat_stiff: KIP_KN / (IN_M * IN_M),          // kip/in/in → kN/m/m (= kN/m²)
    spring_disc: KIP_KN / IN_M,                 // 이산 스프링 kip/in → kN/m
    rot_spring_disc: KIP_KN * IN_M,             // 이산 회전 스프링 kip·in/rad → kN·m/rad
    force_per_length: KIP_KN / IN_M,            // 단위 길이당 힘 kip/in → kN/m (검토 항목 계약의 quantity)
};

export type UnitKey = keyof typeof US_TO_SI;

/** SI 값 × SI_TO_US[unit] ≈ US 값 (정보용; 입력 변환은 toUS 의 나눗셈을 쓴다). */
export const SI_TO_US = Object.fromEntries(
    Object.entries(US_TO_SI).map(([k, v]) => [k, 1 / v])) as Record<UnitKey, number>;

/** 단위 종류의 표시 이름 (SI · US). */
export const UNIT_LABEL: Record<UnitKey, { SI: string; US: string }> = {
    length: { SI: 'mm', US: 'in' },
    area: { SI: 'mm^2', US: 'in^2' },
    modulus: { SI: 'mm^3', US: 'in^3' },
    inertia: { SI: 'mm^4', US: 'in^4' },
    warping: { SI: 'mm^6', US: 'in^6' },
    stress: { SI: 'MPa', US: 'ksi' },
    force: { SI: 'kN', US: 'kips' },
    moment: { SI: 'kN-m', US: 'kip-in' },
    moment_ft: { SI: 'kN-m', US: 'kip-ft' },
    length_ft: { SI: 'm', US: 'ft' },
    linload: { SI: 'kN/m', US: 'plf' },
    pressure: { SI: 'kPa', US: 'psf' },
    density: { SI: 'kg/m^3', US: 'kip-s^2/in^4' },
    rot_stiff: { SI: 'kN-m/rad/m', US: 'kip-in/rad/in' },
    lat_stiff: { SI: 'kN/m/m', US: 'kip/in/in' },
    spring_disc: { SI: 'kN/m', US: 'kip/in' },
    rot_spring_disc: { SI: 'kN-m/rad', US: 'kip-in/rad' },
    force_per_length: { SI: 'kN/m', US: 'kip/in' },
};

/**
 * 검토 항목 계약(2026-11-23, docs/implementation/20261123-check-contract.md §3.2)의 `quantity` 어휘 → 단위 종류.
 * `{symbol, value, quantity}` 꼴의 값은 키 이름이 아니라 이 표로 바꾼다(design_checks 의 소요 · 강도 · 단계 입력 · 결과 ·
 * 반파장 · 위치 …). 엔진의 design.checks.QUANTITIES 와 같은 어휘여야 한다 — 시험(mcp_si_chain)이 엔진 표와 맞댄다.
 * 표에 없는 quantity 는 바꾸지 않고 `si_unconverted` 로 돌려준다(조용히 섞이지 않게).
 */
export const QUANTITY_UNITS: Record<string, UnitKey | 'none'> = {
    force: 'force',
    moment: 'moment',
    stress: 'stress',
    length: 'length',
    area: 'area',
    section_modulus: 'modulus',
    moment_of_inertia: 'inertia',
    torsion_constant: 'inertia',
    warping_constant: 'warping',
    force_per_length: 'force_per_length',
    rotational_stiffness: 'rot_stiff',
    dimensionless: 'none',
    angle: 'none',
    count: 'none',
};

/** quantity 이름 → 단위 종류. 어휘에 없으면 undefined. */
export function quantityUnit(quantity: unknown): UnitKey | 'none' | undefined {
    return typeof quantity === 'string' && Object.prototype.hasOwnProperty.call(QUANTITY_UNITS, quantity)
        ? QUANTITY_UNITS[quantity] : undefined;
}

/** 엔진 steps[].unit 문자열 → 단위 종류. '' · 'ea' 등 무차원은 null. */
const STEP_UNIT: Record<string, UnitKey | null> = {
    'kips': 'force', 'kip': 'force', 'kip-in': 'moment', 'kip-ft': 'moment_ft',
    'in': 'length', 'in.': 'length', 'ksi': 'stress', 'in^2': 'area', 'in²': 'area',
    'in^3': 'modulus', 'in³': 'modulus', 'in^4': 'inertia', 'in⁴': 'inertia',
    'in^6': 'warping', 'in⁶': 'warping', 'ft': 'length_ft', 'plf': 'linload', 'psf': 'pressure',
    'kip-in/rad/in': 'rot_stiff', 'kip/in/in': 'lat_stiff',
    '': null, 'ea': null, '-': null, 'deg': null, 'rad': null, 'ratio': null,
};

/** SI 입력 한 값 → US. 나눗셈 + 15 자리 맞춤(12.7 mm → 정확히 0.5 in). */
export function toUS(value: number, unit: UnitKey): number {
    return Number((value / US_TO_SI[unit]).toPrecision(15));
}

/** US 출력 한 값 → SI. 곱셈만(반올림 없음). */
export function toSI(value: number, unit: UnitKey): number {
    return value * US_TO_SI[unit];
}

/**
 * K2: 검토 상태 키의 단위 종류(webview/js/designState.js FIELDS 의 셋째 열) → 이 파일의 단위.
 * get_case_inputs · set_case_inputs 와 설계 도구 응답의 case_inputs_replaced 가 쓴다.
 */
export const CASE_UNIT_KIND: Record<string, UnitKey> = {
    length: 'length', length_ft: 'length_ft', thickness: 'length', radius: 'length', stress: 'stress', force: 'force',
    moment: 'moment', pressure: 'pressure', inertia: 'inertia', rotStiff: 'rot_stiff', latStiff: 'lat_stiff', density: 'density',
};
/** 검토 상태의 값(수 · 수의 목록 · null) US → SI. 단위 종류를 모르면 그대로 */
export function caseValueToSI(v: any, kind: string | null): any {
    const u = kind ? CASE_UNIT_KIND[kind] : undefined;
    if (!u) { return v; }
    if (typeof v === 'number' && isFinite(v)) { return toSI(v, u); }
    if (Array.isArray(v)) { return v.map((x) => (typeof x === 'number' && isFinite(x) ? toSI(x, u) : x)); }
    return v;
}
/** 검토 상태의 값 SI → US(입력) */
export function caseValueToUS(v: any, kind: string | null): any {
    const u = kind ? CASE_UNIT_KIND[kind] : undefined;
    if (!u) { return v; }
    if (typeof v === 'number' && isFinite(v)) { return toUS(v, u); }
    if (Array.isArray(v)) { return v.map((x) => (typeof x === 'number' && isFinite(x) ? toUS(x, u) : x)); }
    return v;
}

// ============================================================
// 변환 표의 모양
// ============================================================
//   Spec = 단위 종류 | 'none'(무차원) | 'keepUS'(US 그대로 두고 표시) | 하위 표 | 열 단위 | 함수
//   하위 표(Table)는 그 dict 안에서 바깥 표보다 먼저 찾는다. '*' 는 그 dict 의 나머지 모든 키.
export type Spec = UnitKey | 'none' | 'keepUS' | Table | ColumnSpec | SpecFn;
export interface Table { [key: string]: Spec }
export interface ColumnSpec { columns: Array<UnitKey | 'none'> | ((row: number[]) => Array<UnitKey | 'none'>) }
export type SpecFn = (value: any, parent: any) => Spec;

function isTable(s: Spec): s is Table {
    return typeof s === 'object' && s !== null && !('columns' in s);
}
function isColumns(s: Spec): s is ColumnSpec {
    return typeof s === 'object' && s !== null && 'columns' in s;
}

type Dir = 'toSI' | 'toUS';

function convNum(v: number, unit: UnitKey | 'none', dir: Dir): number {
    if (unit === 'none' || !Number.isFinite(v)) { return v; }
    return dir === 'toSI' ? toSI(v, unit) : toUS(v, unit);
}

interface Ctx { dir: Dir; unconverted: string[] }

function lookup(chain: Table[], key: string): Spec | undefined {
    for (const t of chain) {
        if (Object.prototype.hasOwnProperty.call(t, key)) { return t[key]; }
        if (Object.prototype.hasOwnProperty.call(t, '*')) { return t['*']; }
    }
    return undefined;
}

function applySpec(value: any, spec: Spec, parent: any, chain: Table[], path: string, ctx: Ctx): any {
    if (typeof spec === 'function') {
        return applySpec(value, spec(value, parent), parent, chain, path, ctx);
    }
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string') {
        return value;
    }
    if (spec === 'keepUS') {
        if (Array.isArray(value)) { return value.map((x) => markUS(x)); }
        return markUS(value);
    }
    if (isColumns(spec)) {
        if (!Array.isArray(value)) { return value; }
        return value.map((row: any) => {
            if (!Array.isArray(row)) { return row; }
            const cols = typeof spec.columns === 'function' ? spec.columns(row) : spec.columns;
            return row.map((x: any, i: number) =>
                (typeof x === 'number' ? convNum(x, cols[i] ?? 'none', ctx.dir) : x));
        });
    }
    if (isTable(spec)) {
        return walk(value, [spec, ...chain], path, ctx);
    }
    // 단위 종류 / 'none' — 수치, 수치 배열(중첩 포함), 또는 dict(안의 키는 같은 표로)
    if (typeof value === 'number') { return convNum(value, spec, ctx.dir); }
    if (Array.isArray(value)) {
        return value.map((x, i) => applySpec(x, spec, value, chain, `${path}[${i}]`, ctx));
    }
    if (typeof value === 'object') {
        // dict 의 모든 값이 같은 단위인 경우(예: input_loads_plf, rho_used)
        return walk(value, [{ '*': spec }, ...chain], path, ctx);
    }
    return value;
}

function markUS(v: any): any {
    if (v && typeof v === 'object' && !Array.isArray(v)) { return { ...v, units: 'US' }; }
    return v;
}

function convertStep(obj: any, ctx: Ctx): any {
    // 엔진 계산 단계 {value, unit, formula?}: 값과 단위는 바꾸고, 식 글은 US 라고 밝힌다.
    const unitStr = String(obj.unit);
    if (!(unitStr in STEP_UNIT)) {
        return { ...obj, unit_note: 'value left in the engine unit shown in `unit` (not converted)' };
    }
    const u = STEP_UNIT[unitStr];
    const out: any = { ...obj };
    if (u && typeof obj.value === 'number') {
        out.value = convNum(obj.value, u, ctx.dir);
        out.unit = ctx.dir === 'toSI' ? UNIT_LABEL[u].SI : UNIT_LABEL[u].US;
    }
    if (typeof obj.formula === 'string') { out.formula_units = 'US'; }
    return out;
}

/**
 * 검토 항목 계약의 물리량 `{symbol, value, quantity, …}` — `value` 를 `quantity` 로 바꾼다(키 이름과 무관).
 * 안의 다른 키(source · rounded_to …)는 같은 규칙으로 걷되, `rounded_to`(엔진이 반올림한 자리)는 이 값의 단위로 —
 * 예: 설계강도 0.001 kip 자리 → 0.0044482 kN. 어휘에 없는 quantity 는 값을 두고 경로를 알린다.
 */
function convertQuantity(obj: any, chain: Table[], path: string, ctx: Ctx): any {
    const unit = quantityUnit(obj.quantity);
    const inner: Table = { rounded_to: unit ?? 'none' };
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
        const p = path ? `${path}.${k}` : k;
        if (k === 'value') {
            if (typeof v === 'number' && unit !== undefined) {
                out[k] = convNum(v, unit, ctx.dir);
            } else {
                if (typeof v === 'number' && ctx.dir === 'toSI') { ctx.unconverted.push(`${p} (unknown quantity '${String(obj.quantity)}')`); }
                out[k] = v;
            }
            continue;
        }
        if (k === 'quantity' || k === 'symbol') { out[k] = v; continue; }
        const here = [inner, ...chain];
        const spec = lookup(here, k);
        out[k] = spec !== undefined ? applySpec(v, spec, obj, here, p, ctx) : walk(v, here, p, ctx);
    }
    return out;
}

function isQuantity(value: any): boolean {
    return typeof value.quantity === 'string' && Object.prototype.hasOwnProperty.call(value, 'value')
        && typeof value.unit !== 'string';
}

function walk(value: any, chain: Table[], path: string, ctx: Ctx): any {
    if (Array.isArray(value)) {
        return value.map((x, i) => walk(x, chain, `${path}[${i}]`, ctx));
    }
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && ctx.dir === 'toSI') { ctx.unconverted.push(path || '(root)'); }
        return value;
    }
    if (isQuantity(value)) { return convertQuantity(value, chain, path, ctx); }
    let src = value;
    if (ctx.dir === 'toSI' && typeof value.unit === 'string' && 'value' in value) {
        src = convertStep(value, ctx);
    }
    const out: any = {};
    for (const [k, v] of Object.entries(src)) {
        const p = path ? `${path}.${k}` : k;
        if (src !== value && (k === 'value' || k === 'unit')) { out[k] = v; continue; }
        const spec = lookup(chain, k);
        if (spec === undefined) {
            if (typeof v === 'number') {
                if (ctx.dir === 'toSI') { ctx.unconverted.push(p); }
                out[k] = v;
            } else if (v !== null && typeof v === 'object') {
                out[k] = walk(v, chain, p, ctx);
            } else {
                out[k] = v;
            }
            continue;
        }
        out[k] = applySpec(v, spec, src, chain, p, ctx);
    }
    return out;
}

/** 입력 인자(SI) → US. 표에 있는 키만 바꾼다. */
export function convertInputSI(params: Record<string, any>, table: Table): Record<string, any> {
    return walk(params, [table], '', { dir: 'toUS', unconverted: [] });
}

/** 엔진 결과(US) → SI. 모르는 수치 키의 경로를 함께 돌려준다. */
export function convertOutputSIDeep(result: any, table: Table): { value: any; unconverted: string[] } {
    const ctx: Ctx = { dir: 'toSI', unconverted: [] };
    const value = walk(result, [table], '', ctx);
    return { value, unconverted: ctx.unconverted };
}

export const TEXT_UNITS_NOTE =
    'units=SI: every numeric field above is SI (mm, mm^2, mm^3, mm^4, mm^6, MPa, kN, kN-m, m, kN/m, kg/m^3). ' +
    'Free text written by the engine (report, steps[].formula, warnings, assumptions, scope_notes, notes, labels, ' +
    'error messages) is in US customary units (in, kips, kip-in, kip-ft, ksi, ft, plf) and was NOT converted; ' +
    'objects marked units:"US" were also left in US units. Quote engine text with its US units. ' +
    'Values tagged with a `quantity` (design_checks: demand, nominal, capacity, steps[].inputs / result, locations) ' +
    'were converted by that quantity: force kN, moment kN-m, stress MPa, length mm, area mm^2, section_modulus mm^3, ' +
    'moment_of_inertia and torsion_constant mm^4, warping_constant mm^6, force_per_length kN/m, ' +
    'rotational_stiffness kN-m/rad/m; dimensionless, angle (deg) and count are unchanged. ' +
    'steps[].expr and steps[].condition are unit-free symbolic text.';

// ============================================================
// 출력 표 — 엔진 결과 키 → 단위 (test/webview/mcp_si_chain.js 가 실제 엔진 출력의 모든 수치 키를 대조)
// ============================================================

const NONE_KEYS = [
    // 비율 · 계수 · 개수 · 색인 · 무차원
    'utilization', 'utilization_reference', 'ratio', 'total', 'P_ratio', 'Mx_ratio', 'My_ratio',
    'M_ratio', 'V_ratio', 'eq_H1_1_1', 'eq_H1_1_2', 'eq_H1_2_1', 'eq_H1_2_2', 'Cb', 'Cb_pos', 'Cmx', 'Cmy',
    'Kt', 'Ky', 'Kx', 'z_factor', 'alpha', 'alpha_x', 'alpha_y', 'beta_dist', 'lambda_v', 'lambda_l',
    'lambda_d', 'lambda_c', 'R_uplift', 'R', 'R_if_confirmed', 'R_per_span', 'uplift_R', 'step', 'thetap',
    'omega', 'phi', 'rupture_omega', 'rupture_phi', 'n_webs', 'Ubs', 'U', 'Usl', 'C', 'Bc', 'm',
    'R_over_t', 'increase_pct', 'bf_over_t', 'n', 'n_minima', 'reference_unsymm', 'stress_scale',
    'curve_index', 'index', 'load_factor', 'load_factor_interp', 'flexure_dcr', 'flexure_dcr_governing',
    'n_max_total', 'n_per_row', 'n_required', 'n_rows', 'n_total', 'n_members', 'n_spans', 'span',
    'support', 'L_over_delta', 'psi', 'n_lengths', 'n_elements', 'n_theta', 'n_na', 'n_thick',
    'neigs_requested', 'neigs_actual', 'nnodes', 'nelems', 'Ct', 'Cv', 'kv', 'mf', 'interaction_value',
    'LF_dist', 'LF_dist_interp', 'LF_global', 'LF_local', 'LF_local_interp', 'LF_single_minimum',
    'curve_length', 'lengths_analyzed', 'm_terms_max', 'n_minima_found',
];

/**
 * 검토 항목 계약의 항목 하나(design_checks[*]). 물리량은 `{symbol, value, quantity}` 꼴이라 walk 가 quantity 로 바꾸고
 * (convertQuantity), 여기에는 quantity 가 붙지 않은 수만 둔다: 비(ratio) · 계수(factor.value, φ 또는 Ω) ·
 * 옛 결과와 맞대는 자릿수(mirrors.*.digits) · 단계의 반올림 자리(steps[].rounded_to — 그 단계 결과의 단위).
 */
const DESIGN_CHECK: Table = {
    ratio: 'none',
    factor: { value: 'none' },
    reference: { ratio: 'none' },
    mirrors: { '*': { digits: 'none' } },
    steps: {
        rounded_to: (_v: any, step: any) => quantityUnit(step?.result?.quantity) ?? 'none',
    },
};

/** 부재 설계(design_member) · 단면 성질 · cutwp · DSM 의 공통 키. */
const MEMBER_KEYS: Table = {
    design_checks: DESIGN_CHECK,
    // K2-5: 검토 상태의 판(수) — 단위 없음
    case_rev: 'none', case_check: { rev: 'none' },
    ...Object.fromEntries(NONE_KEYS.map((k) => [k, 'none' as const])),
    // 힘 kips
    ...Object.fromEntries(['Pn', 'Pne', 'Pnl', 'Pnd', 'Py', 'Pn_omega', 'phi_Pn', 'Pu', 'Pa', 'Pc',
        'Tn', 'Tn_yield', 'Tn_rupture', 'Tu', 'Vn', 'Vy', 'Vcr', 'Vu', 'Vn_used', 'PEx', 'PEy',
        'Pcrl', 'Pcrd', 'Pcre', 'P_y', 'P_ref', 'Pn_per_web', 'Rn', 'Rn1', 'Rn2', 'phi_Rn',
        'Pns', 'V_transfer', 'capacity', 'demand', 'Tn_net_rupture_D3',
        'design_net_rupture_D3', 'design_rupture', 'design_yield', 'phi_Tn', 'P_raw',
        'shear_design_strength', 'tension_design_strength', 'shear_verified_design_strength',
        'tension_verified_design_strength', 'Pnt_prime', 'T_required', 'V_required',
        'available_tension', 'wc_P', 'Vn_per_web', 'Pnvs', 'Pnts', 'Pnov_bolt', 'Pnot_test'].map((k) => [k, 'force' as const])),
    // 모멘트 kip-in
    ...Object.fromEntries(['Mn', 'Mne', 'Mnl', 'Mnd', 'My', 'Mn_dsm', 'Mn_omega', 'phi_Mn', 'Mu',
        'Mu_pos', 'Mux', 'Muy', 'Mux_amp', 'Muy_amp', 'Maxt', 'Mayt', 'Mnfo', 'Mn_R', 'Mnlo',
        'Ma_x', 'Mc_x', 'Ma_y', 'Mc_y', 'Mcrl', 'Mcrd', 'Mcre', 'Mxxcrl', 'Mxxcrd', 'Mxxcre',
        'Mzzcrl', 'Mzzcrd', 'Mzzcre', 'My_xx', 'My_zz', 'M11_y', 'M22_y', 'Mxx_y', 'Mzz_y',
        'M11_raw', 'M22_raw', 'Mn_lap', 'phi_Mn_lap', 'May_strength', 'Mnd_single', 'wc_M', 'Malo', 'Mao'].map((k) => [k, 'moment' as const])),
    // 응력 ksi
    ...Object.fromEntries(['Fy', 'Fu', 'Fcre', 'Fcrl', 'Fcrd', 'Fn', 'Fy_original', 'Fy_used', 'Fya',
        'Fyc', 'Fyv', 'Fuv', 'sigma_ey', 'sigma_ex', 'sigma_t', 'sigma_ez', 'E', 'G', 'E_ksi', 'Fnt',
        'Fnt_reduced', 'Fnv', 'fv', 'f_avg', 'max_node_stress', 'fy', 'Fub', 'Fxx', 'Fuf', 'fy_used',
        'fy_analysis'].map((k) => [k, 'stress' as const])),
    // 길이 in
    ...Object.fromEntries(['Lb', 'Lt', 'Ly', 'Lx', 'L', 'ro', 'rx', 'ry', 'rz', 'xo', 'zo', 'Xs', 'Zs',
        'xcg', 'zcg', 't', 'd', 'h', 'N', 'Lo', 'edge_distance', 'L_effective', 'Lcrl', 'Lcrd', 'Lcre',
        'Lcre_signature', 'lap_left_in', 'lap_right_in', 'min_lap', 'spacing', 'fastener_dia',
        'actual_in', 'min_lap_in', 'd_lip', 'h_web', 'b_flange', 'cf', 'allowable_cf', 'bf', 'B1', 'B2',
        'x_bar', 'L_conn', 'length', 'length_interp', 'provided', 'required', 'depth', 'flange_width',
        'thickness', 'lip_depth', 'R_corner', 'dist_Lm', 'Lm'].map((k) => [k, 'length' as const])),
    // 면적 · 단면계수 · 단면2차 · 뒴
    ...Object.fromEntries(['A', 'Ag', 'An', 'An_used', 'An_net', 'Ae', 'warp'].map((k) => [k, 'area' as const])),
    ...Object.fromEntries(['Sf', 'Sx', 'Sz', 'Sx_cl', 'Sz_cl', 'Zx', 'Zz', 'Sxx', 'Szz', 'Sy', 'Se'].map((k) => [k, 'modulus' as const])),
    ...Object.fromEntries(['Ixx', 'Izz', 'Ixz', 'I11', 'I22', 'J', 'Ix', 'Iy', 'I_span_in4'].map((k) => [k, 'inertia' as const])),
    Cw: 'warping',
    // 가용강도: 휨 결과(Mn · phi_Mn 이 있는 dict, member_type flexure)는 kip-in, 그 밖(압축 · 인장 · 전단 · 접합)은 kips
    design_strength: (_v: any, parent: any) => (parent && typeof parent === 'object'
        && ('Mn' in parent || 'phi_Mn' in parent || 'Mn_omega' in parent || parent.member_type === 'flexure')
        ? 'moment' : 'force'),
    // 데크 강성
    kphi: 'rot_stiff', kx: 'lat_stiff', kphi_override: 'rot_stiff', kx_override: 'lat_stiff',
    // 접합부 상호작용: 볼트 F'nt 검토만 kips, 나머지(J4.5 · J2.2.4 · J5.4)는 무차원 합
    interaction_checks: {
        value: (_v: any, parent: any) => (String(parent?.name || '').startsWith('Bolt tension') ? 'force' : 'none'),
        limit: (_v: any, parent: any) => (String(parent?.name || '').startsWith('Bolt tension') ? 'force' : 'none'),
    },
    demands: { '*': 'force' },
    web_crippling: { P: 'force', load: 'force', Pn_interior_cap: 'force' },
    h3_interaction: { P_term: 'none', M_term: 'none', limit: 'none' },
    // 엔진이 US 라벨과 함께 내는 조건표 — 값은 라벨의 US 단위 그대로 둔다
    conditions: 'keepUS',
    // 엔진이 표시용으로 반올림한 키와 그 소수 자리(2026-11-23) — US 값의 자리라 SI 에서는 그대로 두고 US 라고 밝힌다
    display_rounding: 'keepUS',
    units: 'none',
};

/** DSM 추출(extract_dsm_values): crl · crd · cre … 는 load_type 에 따라 힘 또는 모멘트. */
function dsmTable(family: 'P' | 'M'): Table {
    const u: UnitKey = family === 'P' ? 'force' : 'moment';
    return {
        ...MEMBER_KEYS,
        crl: u, crd: u, cre: u, cre_signature: u, P_y: u, P_ref: u, single_minimum_bound: u,
        crd_floor: u, crl_floor: u, P_ref_restrained: u,
        Pcrl: 'force', Pcrd: 'force', Pcre: 'force', Pcrd_floor: 'force', Pcrl_floor: 'force',
        Mcrd_floor: 'moment', Mcrl_floor: 'moment',
        minima: { length: 'length', length_interp: 'length' },
    };
}
export const SI_OUT_DSM_P: Table = dsmTable('P');
export const SI_OUT_DSM_M: Table = dsmTable('M');

/** 부재 설계 결과 (compression / flexure / combined / tension / connection) — 중첩 · 한계상태 포함. */
export const SI_OUT_MEMBER: Table = { ...MEMBER_KEYS };

/** get_design_check (K4a 3a): 검토 항목 하나(`check`)와 그 위치. */
export const SI_OUT_DESIGN_CHECK: Table = { ...MEMBER_KEYS, check: DESIGN_CHECK };

/** 단면 성질 · cutwp · 소성 곡면. */
export const SI_OUT_PROPS: Table = { ...MEMBER_KEYS, P: 'none', M11: 'none', M22: 'none' };

/** 하중 해석(analyze_loads): 모멘트 kip-ft, 위치 ft, 하중 plf, 비지지길이 in, 처짐 in. */
export const SI_OUT_LOADS: Table = {
    ...MEMBER_KEYS,
    ...Object.fromEntries(['Mu', 'Mu_max', 'Mu_min', 'M1', 'M2', 'MA', 'MB', 'MC', 'Mmax', 'M_max_abs',
        'max_abs_M', 'max_neg_M', 'max_pos_M', 'M_diagram', 'M_envelope_max', 'M_envelope_min',
        'Mu_kipft'].map((k) => [k, 'moment_ft' as const])),
    ...Object.fromEntries(['R_bearing', 'R_max', 'R_min', 'R_uplift', 'Ru', 'Vu', 'Vu_left', 'Vu_right',
        'V_diagram', 'V_envelope_max', 'V_envelope_min', 'R_envelope_max', 'R_envelope_min', 'max_R',
        'max_abs_V', 'Pu'].map((k) => [k, 'force' as const])),
    ...Object.fromEntries(['x_ft', 'overhang_ft', 'L_ft', 'start_ft', 'end_ft', 'x_M_max_ft', 'x_diagram',
        'inflection_points_ft', 'inflection_points_min_envelope_ft', 'lap_ends_ft', 'supports_ft',
        'spans_ft', 'left_ft', 'right_ft', 'span_ft', 'brace_points_ft', 'spacing_ft'].map((k) => [k, 'length_ft' as const])),
    ...Object.fromEntries(['Lt_in', 'Ly_in', 'Lt', 'Ly', 'delta_in', 'abs_delta_in', 'D_diagram',
        'D_envelope_max', 'D_envelope_min', 'insulation_in'].map((k) => [k, 'length' as const])),
    governing_span_loads_plf: 'linload', input_loads_plf: 'linload', strong_axis_loads_plf: 'linload',
    loads_plf: 'linload',
    factors: { '*': 'none' },
    R: 'none', uplift_R: 'none', R_tested_uplift: 'none', R_tested_gravity: 'none',
    // 하중 해석의 단면 · 데크 블록은 부재 설계 키(in · ksi)
    kx_detail: { Ka: 'spring_disc', Ke: 'spring_disc', inputs: { D_screw_in: 'length', Fss_kip: 'force', Fu1_ksi: 'stress', Fu2_ksi: 'stress', t_panel: 'length', t_purlin: 'length' } },
};

/** 데크 강성(calc_deck_stiffness). */
export const SI_OUT_DECK: Table = {
    ...MEMBER_KEYS,
    kx_detail: {
        Ka: 'spring_disc', Ke: 'spring_disc', kx: 'lat_stiff',
        inputs: { D_screw_in: 'length', Fss_kip: 'force', Fu1_ksi: 'stress', Fu2_ksi: 'stress', t_panel: 'length', t_purlin: 'length' },
    },
    units: 'none',
};

/** 진동: 진동수 Hz(그대로), 밀도. */
export const SI_OUT_VIBRATION: Table = {
    frequencies: 'none', shapes: 'none', rho_used: 'density', lengths: 'length', size: { '*': 'none' }, ...Object.fromEntries(NONE_KEYS.map((k) => [k, 'none' as const])),
};

/** get_dsm_values 응답 {P|Mxx|Mzz: dsm, fy_used, load_family}. */
export const SI_OUT_GET_DSM: Table = { P: SI_OUT_DSM_P, Mxx: SI_OUT_DSM_M, Mzz: SI_OUT_DSM_M, fy_used: 'stress' };

/** run_analysis 응답(dsm_P · dsm_Mxx · dsm_Mzz 와 곡선 요약). */
export const SI_OUT_RUN_ANALYSIS: Table = {
    dsm_P: SI_OUT_DSM_P, dsm_Mxx: SI_OUT_DSM_M, dsm_Mzz: SI_OUT_DSM_M,
    lengths: 'length', lengths_requested: 'length', discarded_lengths: 'length',
    ...Object.fromEntries(NONE_KEYS.map((k) => [k, 'none' as const])),
};

/**
 * 퍼린 구간 설계의 구간 결과(호스트 StcfsdPanel._designPurlin): 부재 설계 결과 + 그 구간에서 검토한 M · V.
 * 설계 입력이라 kip-in · kips(하중 해석의 kip-ft 가 아님).
 */
const PURLIN_REGION_RESULT: Table = {
    ...SI_OUT_MEMBER,
    Mu_checked: 'moment', Vu_checked: 'force', check_point: 'none',
    checks: { Mu: 'moment', Vu: 'force' },
    supports_checked: { Pu: 'force', support: 'none' },
};
/** 퍼린 구간: 위치는 ft(하중 해석 좌표), Ly 는 in, Mu · Vu 는 설계 입력(kip-in · kips). */
const PURLIN_REGION: Table = {
    ...SI_OUT_MEMBER,
    start_ft: 'length_ft', end_ft: 'length_ft', x_M_max_ft: 'length_ft', Ly_in: 'length',
    span: 'none', support: 'none', Mu: 'moment', Vu: 'force', members: 'none',
    result: PURLIN_REGION_RESULT,
};
const PURLIN_GOVERNING: Table = { ...PURLIN_REGION_RESULT, region: PURLIN_REGION };

/** design_purlin 묶음 (V4-16: 구간 · 검토점 · 지배 구간까지). */
export const SI_OUT_PURLIN: Table = {
    load_analysis: SI_OUT_LOADS,
    case_rev: 'none', case_check: { rev: 'none' },
    dsm_positive: SI_OUT_DSM_M, dsm_negative: SI_OUT_DSM_M,
    regions: PURLIN_REGION,
    design_positive: PURLIN_GOVERNING, design_negative: PURLIN_GOVERNING, design_lap: PURLIN_GOVERNING,
    design_uplift: PURLIN_GOVERNING,
    i621_check: SI_OUT_LOADS, wc_reactions: SI_OUT_LOADS, uplift_reactions: SI_OUT_LOADS,
    props: SI_OUT_PROPS, cutwp: SI_OUT_PROPS, deck: SI_OUT_DECK,
    ...SI_OUT_MEMBER,
};

/** generate_report 묶음. */
export const SI_OUT_REPORT: Table = {
    section_props: SI_OUT_PROPS, cutwp_props: SI_OUT_PROPS,
    dsm_P: SI_OUT_DSM_P, dsm_Mxx: SI_OUT_DSM_M, dsm_Mzz: SI_OUT_DSM_M,
    prepared_design_dsm: { P: SI_OUT_DSM_P, Mxx: SI_OUT_DSM_M, Mzz: SI_OUT_DSM_M },
    load_analysis: SI_OUT_LOADS,
    design_result: (v: any) => (v && typeof v === 'object' && 'load_analysis' in v ? SI_OUT_PURLIN : SI_OUT_MEMBER),
    model_summary: 'keepUS', analysis_meta: 'keepUS',
    ...SI_OUT_MEMBER,
};

/** validate_design 묶음. */
export const SI_OUT_VALIDATE: Table = {
    props: SI_OUT_PROPS, cutwp: SI_OUT_PROPS,
    dsm_P: SI_OUT_DSM_P, dsm_Mxx: SI_OUT_DSM_M, dsm_Mzz: SI_OUT_DSM_M,
    last_load_analysis: SI_OUT_LOADS,
    last_design_result: (v: any) => (v && typeof v === 'object' && 'load_analysis' in v ? SI_OUT_PURLIN : SI_OUT_MEMBER),
    status: 'keepUS',
    ...SI_OUT_MEMBER,
};

// ============================================================
// 입력 표 — 도구 이름 → 인자 단위 (SI 일 때만 쓴다)
// 각 도구 스키마의 수치 인자는 여기 있거나 SI_INPUT_DIMENSIONLESS 에 있어야 한다(계약 시험).
// ============================================================

const L: UnitKey = 'length';
const S: UnitKey = 'stress';
const F: UnitKey = 'force';
const MOM: UnitKey = 'moment';
const AR: UnitKey = 'area';

const CONNECTION_INPUT: Table = {
    Fy: S, Fu: S, Fub: S, Fxx: S, Fuf: S, Fy1: S, Fy2: S, Fu1: S, Fu2: S, E: S,
    t1: L, t2: L, t_head: L, t_far: L, t_sheets: L, tc: L, d: L, e: L, s: L, g: L, width: L, s_pitch: L,
    pitch: L, edge_transverse: L, weld_length: L, weld_size: L, L_seam: L, da: L, dar: L, de: L, dw: L,
    d_head_washer: L, w1: L, w2: L, R: L, R2: L, h: L, te: L, d1: L, d2: L, x_bar: L, L_conn: L,
    b1: L, b2: L, bf: L, bw: L, pattern_length: L,
    Ag: AR, Ae: AR, Ant: AR, Agv_bs: AR, Anv_bs: AR, Ant_bs: AR,
    j6_part2: { t: L, Fu: S, Fy: S, e: L, width: L, Ag: AR, g: L, edge_transverse: L },
    Pu: F, Vu: F, Tu: F, Pnvs: F, Pnts: F, Pnov_bolt: F, Pnot_test: F,
};

const LOADS_INPUT: Table = {
    span_ft: 'length_ft', spans_ft: 'length_ft', spacing_ft: 'length_ft', brace_points_ft: 'length_ft',
    loads: { '*': 'linload' },
    laps: { left_ft: 'length_ft', right_ft: 'length_ft' },
    laps_per_support: { left_ft: 'length_ft', right_ft: 'length_ft' },
    E: S, insulation_in: L, I_span_in4: 'inertia',
    section: {
        depth: L, flange_width: L, thickness: L, lip_depth: L, R_corner: L, Fy: S, Fu: S,
        Ixx: 'inertia', E: S, qlip: 'none', I_span_in4: 'inertia',
    },
    deck: {
        t_panel: L, fastener_spacing: L, kphi_override: 'rot_stiff', kx_override: 'lat_stiff',
        Fss_kip: F, D_screw_in: L, Fu_panel_ksi: S, b_fastener_in: L, c_fastener_in: L,
        insulation_in: L, R_tested_uplift: 'none', R_tested_gravity: 'none', brace_points_ft: 'length_ft',
    },
};

/** CUFSM 스프링 행 [#, nodei, nodej, ku, kv, kw, kq, local, discrete, ys] — discrete 에 따라 단위가 다르다. */
const SPRING_COLUMNS: ColumnSpec = {
    columns: (row: number[]) => {
        const discrete = Number(row[8]) === 1;
        const k: UnitKey = discrete ? 'spring_disc' : 'lat_stiff';
        const kq: UnitKey = discrete ? 'rot_spring_disc' : 'rot_stiff';
        return ['none', 'none', 'none', k, k, k, kq, 'none', 'none', 'none'];
    },
};

export const SI_INPUT_TABLES: Record<string, Table> = {
    // K2-5: 검토 상태 도구 — 값의 단위는 키마다 다르고(designState FIELDS) 호스트가 CASE_UNIT_KIND 로 바꾼다. 이 표로는 바꾸지 않는다.
    get_case_inputs: {}, set_case_inputs: {}, run_case_check: {},
    get_dsm_values: { fy: S, KxLx: L, KyLy: L, KtLt: L, Lb: L },
    set_section_template: { H: L, B: L, D: L, t: L, r: L, OD: L, top_width: L, depth: L, brim: L, tf: L, tw: L },
    set_custom_section: { outer_corners: L, t: L, R_inner: L, corner_radii: L, max_elem_len: L, expected_A: AR },
    build_section: {
        t: L, R_inner: L, max_elem_len: L, expected_A: AR, expected_center: L,
        steps: { length: L, x: L, y: L, protrusion: L, height: L, width: L, depth: L, lip_length: L, dx: L, dy: L },
    },
    set_material: { E: S, G: S },
    set_load_case: { fy: S, P: F, Mxx: MOM, Mzz: MOM },
    set_stress: { fy: S, P: F, Mxx: MOM, Mzz: MOM },
    set_lengths: { min: L, max: L },
    set_node_stress: { stress: S },
    set_nodes: {
        nodes: { columns: ['none', L, L, 'none', 'none', 'none', 'none', S] },
        elements: { columns: ['none', 'none', 'none', L, 'none'] },
    },
    set_elements: { elements: { columns: ['none', 'none', 'none', L, 'none'] } },
    add_node: { x: L, z: L, stress: S },
    add_element: { thickness: L },
    modify_node: { x: L, z: L, stress: S },
    modify_element: { thickness: L },
    run_plastic_surface: { fy: S },
    run_vibration: { rho: 'density', lengths: L },
    set_springs: { springs: SPRING_COLUMNS },
    aisi_design_compression: { Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Pu: F, Fcre: S },
    aisi_design_flexure: {
        Fy: S, Fu: S, Lb: L, Lb_pos: L, Mu: MOM, Mu_pos: MOM, Vu: F, Fcre: S, kphi: 'rot_stiff',
        dist_Lm: L, wc_N: L, wc_R: L, wc_overhang: L, wc_edge_distance: L, wc_support_fastener_spacing: L,
        wc_P: F, wc_M: MOM,
    },
    aisi_design_combined: {
        Fy: S, Fu: S, KxLx: L, KyLy: L, KtLt: L, Lb: L, L: L, Pu: F, Vu: F,
        Mux: MOM, Muy: MOM, May_strength: MOM, Fcre: S, dist_Lm: L,
    },
    aisi_design_tension: { Fy: S, Fu: S, Tu: F, An: AR },
    aisi_design_connection: CONNECTION_INPUT,
    design_connection: CONNECTION_INPUT,
    get_web_crippling: {
        h: L, t: L, R: L, N: L, Fy: S, Lo: L, edge_distance: L, support_fastener_spacing: L, d: L,
    },
    analyze_loads: { ...LOADS_INPUT, Fy: S, Fu: S },
    design_purlin: {
        ...LOADS_INPUT, Fy: S, Fu: S,
        wc_N: L, wc_R: L, wc_overhang: L, wc_edge_distance: L, wc_support_fastener_spacing: L,
    },
    calc_deck_stiffness: {
        t_panel: L, t_purlin: L, fastener_spacing: L, flange_width: L, k_per_fastener: 'spring_disc', E: S,
        b_fastener: L, c_fastener: L, Fss_kip: F, D_screw_in: L, Fu1_ksi: S, Fu2_ksi: S,
        kphi_override: 'rot_stiff', kx_override: 'lat_stiff',
    },
    generate_report: {
        Fy: S, Fu: S, Mu: MOM, Pu: F, Lb: L, KxLx: L, KyLy: L, KtLt: L, span_ft: 'length_ft',
        spacing_ft: 'length_ft', loads: { '*': 'linload' },
    },
    validate_design: { Fy: S },
    design_lap_connection: {
        d: L, t: L, Fy: S, Fu: S, lap_left_in: L, lap_right_in: L, Mu_support: MOM, Vu_support: F,
        fastener_dia: L, end_distance: L, Se: 'modulus', Sf: 'modulus', Mnd: MOM, Mnd_single: MOM,
        Vn: F, h_web: L, Pnvs: F, Fub: S,
    },
    check_lap_length: { d: L, lap_left: L, lap_right: L },
    check_shear_lag: {
        Ag: AR, An_net: AR, x_bar: L, L_conn: L, Fu: S, Fy: S, d: L, s: L, b1: L, b2: L, bf: L, bw: L,
    },
    check_block_shear: { Agv: AR, Anv: AR, Ant: AR, Fy: S, Fu: S },
    cold_work: { Fyv: S, Fuv: S, R: L, t: L, A_corners: AR, A_flange: AR, A_total: AR },
    flange_curling: { bf: L, t: L, h: L, d: L, f_avg: S, E: S, allowable_cf: L },
    // K4a 3a: 검토 항목 하나 — 수치 인자 없음(units 는 응답의 단위)
    get_design_check: {},
};

/** SI 에서도 바꾸지 않는 수치 인자(무차원 · 개수 · 색인 · 각도). */
export const SI_INPUT_DIMENSIONLESS: Record<string, string[]> = {
    // K2-5: 단위는 호스트가 키마다(CASE_UNIT_KIND) — 표 변환을 하지 않는다는 뜻으로 여기 둔다
    set_case_inputs: ['inputs', 'spans.spans', 'spans.lapsPerSupport.left', 'spans.lapsPerSupport.right'],
    set_section_template: ['qlip', 'nseg', 'n_elem'],
    set_custom_section: ['n_arc', 'n_flat'],
    build_section: ['n_arc', 'n_flat'],
    set_material: ['v'],
    set_lengths: ['n'],
    set_node_stress: ['node_ids'],
    add_element: ['nodei', 'nodej'],
    modify_node: ['node_id'],
    modify_element: ['elem_id', 'nodei', 'nodej'],
    set_springs: [],
    run_plastic_surface: ['n_theta', 'n_na', 'n_fibers_per_elem', 'n_thick'],
    get_dsm_values: ['Cb', 'unsymm'],
    aisi_design_compression: [],
    aisi_design_flexure: ['Cb', 'Cb_pos', 'R_uplift', 'dist_M1_M2', 'wc_n_webs', 'shear_n_webs'],
    aisi_design_combined: ['Cb', 'Cmx', 'Cmy', 'dist_M1_M2', 'shear_n_webs'],
    aisi_design_tension: [],
    aisi_design_connection: ['n', 'n_rows_long', 'HRC_p', 'alpha_w', 'alpha_b', 'Usl', 'mf', 'washers'],
    design_connection: ['n', 'n_rows_long', 'HRC_p', 'alpha_w', 'alpha_b', 'Usl', 'mf', 'washers'],
    get_web_crippling: ['theta', 'n_webs'],
    analyze_loads: [],
    design_purlin: ['wc_n_webs'],
    calc_deck_stiffness: [],
    generate_report: ['Cb'],
    validate_design: [],
    design_lap_connection: ['n_rows', 'mf'],
    check_lap_length: [],
    check_shear_lag: ['Usl'],
    check_block_shear: ['Ubs', 'phi_factor', 'omega_factor'],
    cold_work: ['n_corners', 'corner_angle', 'corners_per_flange'],
    flange_curling: [],
    get_design_check: [],
};
