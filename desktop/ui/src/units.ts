/**
 * 표시 단위 — 이 화면에서 단위를 바꾸는 곳은 여기 하나다.
 *
 * 엔진 · 호스트 모델은 US(in · ksi · kips · kip-in)다. 화면은 SI(mm · MPa · kN · kN·m)로 **보이기만** 한다.
 * 계수와 표는 제품의 `src/mcp/siUnits.ts` 를 그대로 쓴다 — MCP 도구가 `units:"SI"` 로 돌려줄 때와 같은 곱셈이다.
 * 그래서 화면의 수 = 같은 상태에서 MCP 도구가 SI 로 돌려준 수(반올림은 글자에서만).
 *
 *  - 결과 묶음(단면 성질 · cutwp · DSM · 부재 설계 · 퍼린 설계)은 그 도구의 출력 표로 통째로 바꾼다(`convertOutputSIDeep`).
 *  - SI 인자가 없는 도구(get_full_state · get_nodes · get_elements)와 호스트 모델(modelLoaded)의 수는 `toSI(값, 종류)` 로 바꾼다.
 *  - 바꾼 값은 화면에만 있다. 모델로 되돌려 보내는 길은 없다(이 화면은 모델을 쓰지 않는다).
 */
import {
  convertOutputSIDeep, toSI, US_TO_SI, SI_OUT_PROPS, SI_OUT_GET_DSM, SI_OUT_MEMBER, SI_OUT_PURLIN, SI_OUT_LOADS, quantityUnit,
  type UnitKey, type Table,
} from '../../../src/mcp/siUnits';

export type Kind = UnitKey | 'none';
export { US_TO_SI };

/** 표시 단위 글자(SI) */
export const LABEL: Record<Kind, string> = {
  length: 'mm', area: 'mm²', modulus: 'mm³', inertia: 'mm⁴', warping: 'mm⁶', stress: 'MPa', force: 'kN',
  moment: 'kN·m', moment_ft: 'kN·m', length_ft: 'm', linload: 'kN/m', pressure: 'kPa', density: 'kg/m³',
  rot_stiff: 'kN·m/rad/m', lat_stiff: 'kN/m/m', force_per_length: 'kN/m', spring_disc: 'kN/m', rot_spring_disc: 'kN·m/rad', none: '',
};

/** US 한 값 → SI(곱셈만). 수가 아니면 그대로 null */
export function si(v: unknown, kind: Kind): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) { return null; }
  return kind === 'none' ? v : toSI(v, kind);
}

function deep<T>(v: T, table: Table): T {
  if (!v || typeof v !== 'object') { return v; }
  return convertOutputSIDeep(v, table).value as T;
}

/** MCP get_section_properties(units SI)와 같은 변환 */
export const propsSI = <T>(v: T): T => deep(v, SI_OUT_PROPS);
/** MCP get_cutwp(units SI)와 같은 변환 */
export const cutwpSI = <T>(v: T): T => deep(v, SI_OUT_PROPS);
/** MCP get_dsm_values(units SI)와 같은 변환 */
export const dsmSI = <T>(v: T): T => deep(v, SI_OUT_GET_DSM);
/** MCP aisi_design_*(units SI)와 같은 변환 */
export const memberSI = <T>(v: T): T => deep(v, SI_OUT_MEMBER);
/** MCP analyze_loads(units SI)와 같은 변환 — 위치 ft → m, 모멘트 kip-ft → kN·m, 힘 kips → kN, 처짐 in → mm, 선하중 plf → kN/m */
export const loadsSI = <T>(v: T): T => deep(v, SI_OUT_LOADS);
/** MCP design_lap_connection · design_connection(units SI)와 같은 변환 */
export const connSI = <T>(v: T): T => deep(v, SI_OUT_MEMBER);
/** MCP design_purlin(units SI)와 같은 변환 */
export const purlinSI = <T>(v: T): T => deep(v, SI_OUT_PURLIN);

/**
 * 검토 항목 계약의 `quantity`(force · moment · stress · length · section_modulus …) → 표시 종류. 값의 변환은 결과 묶음을 통째로
 * 바꿀 때(memberSI · purlinSI · connSI — 제품 표가 `{symbol, value, quantity}` 를 quantity 로 바꾼다) 이미 끝났다 — 여기서는
 * 그 값에 붙일 단위 글자와 data-u 만 정한다. 어휘에 없는 quantity 는 'none' 이 아니라 null(모름)을 돌려준다.
 */
export function kindOfQuantity(q: unknown): Kind | null {
  const u = quantityUnit(q);
  return u === undefined ? null : u;
}

/** 1 m = 1000 mm — 화면의 부재 축(m)에 검토 위치 x(mm, SI 로 바꾼 값)를 놓을 때만(표시 축척, 공학 값이 아니다) */
export const mmToM = (v: number): number => v / 1000;

/** 화면에 적는 변환 설명(풍선 도움말) */
export const UNITS_NOTE = '엔진은 US 단위로 계산한다. 화면은 MCP 의 units:"SI" 와 같은 계수로 바꿔 보이기만 한다(1 in = 25.4 mm, 1 ksi = 6.894757 MPa, 1 kip = 4.448222 kN). 엔진이 쓴 글(경고 · 가정 · 범위)은 US 그대로다.';
