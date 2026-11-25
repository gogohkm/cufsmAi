/**
 * 글자 만들기 — 수 · 판정비 · 판정 · 시각. 계산하지 않는다: 엔진이 준 수를 반올림해 적을 뿐이다.
 *
 * 화면의 수마다 `<span class="num" data-v data-src data-u>` 를 단다. `data-v` 는 보인 수의 반올림 전 값(SI),
 * `data-src` 는 그 값이 온 곳(`props:A` = MCP get_section_properties 의 A, `full:material.E` = get_full_state …),
 * `data-u` 는 단위 종류(units.ts). 시험(`ui/test/ui.mjs`)이 이것으로 화면의 수 = MCP 의 수를 하나하나 대조한다.
 */
import { esc, tip } from './dom';
import { LABEL, type Kind } from './units';

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n: number) => String(n).split('').map(c => SUP[c] ?? c).join('');

/** 유효 숫자 sig 자리. 큰 수는 정수로, 천 단위 사이를 띄운다(템플릿과 같이 「1 540」) */
export function sigText(v: number, sig = 4): string {
  if (!Number.isFinite(v)) { return '—'; }
  if (v === 0) { return '0'; }
  const a = Math.abs(v);
  // 계산 잡음(−1e−16 같은 것)은 0 으로 적는다 — 소수 6 자리 아래는 보이지 않는다(값은 data-v 에 그대로)
  if (a < 0.5e-6) { return '0'; }
  let s: string;
  if (a >= 10 ** sig || (Number.isInteger(v) && a < 1e15)) { s = Math.round(v).toString(); } else {
    const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    s = v.toFixed(Math.min(digits, 6));
  }
  const [i, f] = s.split('.');
  const neg = i.startsWith('-');
  const body = (neg ? i.slice(1) : i).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg ? '−' : ''}${body}${f !== undefined ? `.${f}` : ''}`;
}

/** 큰 단면 값은 ×10ⁿ(3 의 배수)으로 — 표시만 */
export function scaleOf(v: number, kind: Kind): number {
  if (!['area', 'modulus', 'inertia', 'warping'].includes(kind)) { return 0; }
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a < 1e5) { return 0; }
  return Math.floor(Math.log10(a) / 3) * 3;
}

export interface NumOpt { src: string; kind: Kind; sig?: number; unit?: boolean; noScale?: boolean; tip?: string }

/** 값이 없으면 「결과 없음」 — 빈칸 · 0 · 옛 수를 적지 않는다 */
export function none(text = '결과 없음', why?: string): string {
  return `<span class="none"${tip(why)}>${esc(text)}</span>`;
}

/** 수 하나(SI 값) + 단위. unit=false 면 단위 글자를 따로 쓰지 않는다 */
export function num(v: number | null | undefined, o: NumOpt): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) { return none(); }
  const e = o.noScale ? 0 : scaleOf(v, o.kind);
  const shown = sigText(v / 10 ** e, o.sig ?? 4);
  const u = LABEL[o.kind];
  const unit = o.unit === false || (!u && !e) ? '' : ` <span class="u">${e ? `×10${sup(e)} ` : ''}${esc(u)}</span>`;
  return `<span class="num" data-v="${v}" data-src="${esc(o.src)}" data-u="${o.kind}" data-x="${e}"${tip(o.tip)}>${shown}</span>${unit}`;
}

/**
 * SVG 의 글 안에 넣는 수 — `<tspan>`(HTML 의 `<span>` 을 SVG 안에 넣으면 HTML 파서가 SVG 를 닫아 버린다). 단위 글자는 붙이지 않는다.
 */
export function tnum(v: number | null | undefined, o: NumOpt): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) { return '<tspan class="none">—</tspan>'; }
  return `<tspan class="num" data-v="${v}" data-src="${esc(o.src)}" data-u="${o.kind}" data-x="0">${sigText(v, o.sig ?? 4)}</tspan>`;
}

/** SVG 글 안의 수 — 보이는 수 = 값 / 10^e(mm 값을 m 로 적을 때 e = 3). data-v 는 값 그대로, data-x = e */
export function tnumX(v: number | null | undefined, e: number, o: NumOpt): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) { return '<tspan class="none">—</tspan>'; }
  return `<tspan class="num" data-v="${v}" data-src="${esc(o.src)}" data-u="${o.kind}" data-x="${e}">${sigText(v / 10 ** e, o.sig ?? 4)}</tspan>`;
}

/** 단위 글자만(표의 단위 칸) */
export function unitOf(v: number | null | undefined, kind: Kind): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) { return ''; }
  const e = scaleOf(v, kind);
  return `${e ? `×10${sup(e)} ` : ''}${LABEL[kind]}`;
}

/** 수만(단위 없이 — 표의 숫자 칸) */
export function bare(v: number | null | undefined, o: NumOpt): string {
  return num(v, { ...o, unit: false });
}

/**
 * 판정비 글자 — 소수 3 자리. NG(엔진 판정 false 또는 1 을 넘는 값)는 올림, 그 밖은 내림:
 * 1.0004 NG 가 「1.000」으로, 0.99996 OK 가 「1.000」으로 보여 판정과 글자가 어긋나지 않게(StAnal formatVerdictRatioV1 과 같은 규칙).
 */
export function ratioText(r: number, ng: boolean): string {
  const k = r * 1000;
  const v = (ng ? Math.ceil(k - 1e-9) : Math.floor(k + 1e-9)) / 1000;
  return v.toFixed(3);
}

export function ratio(r: number | null | undefined, ng: boolean, src: string): string {
  if (typeof r !== 'number' || !Number.isFinite(r)) { return none(); }
  return `<span class="num" data-v="${r}" data-src="${esc(src)}" data-u="none" data-x="0" data-ratio="${ng ? 'ng' : 'ok'}">${ratioText(r, ng)}</span>`;
}

/**
 * 엔진의 이용률(utilization)을 판정비로 보여도 되는가 — 엔진이 `utilization_valid: false` 를 달면(주 소요를 주지 않음 · 평가하지 못한 한계상태가 있음,
 * 계약 §6.4) 그 수는 평가한 것 가운데의 비일 뿐이다: 판정 없음으로 읽는다(수를 보이지 않는다). NG(pass false)면 그 비가 NG 의 근거라 그대로.
 * `x` 는 엔진의 결과(US — utilization_valid · pass 가 있는 것), `u` 는 보일 수(SI 로 바꾼 것일 수 있다)
 */
export function utilShown(x: any, u: unknown = x?.utilization): number | null {
  if (typeof u !== 'number' || !Number.isFinite(u)) { return null; }
  // E-1: 엔진이 가정한 길이(빈 KxLx · KyLy · KtLt · Lb 의 기본값)로 낸 결과의 이용률은 그 길이의 비다 — NG 여도 판정비로 적지 않는다(참고만, refRatio)
  if (lengthAssumed(x)) { return null; }
  if (x && typeof x === 'object' && x.pass !== false && (x.utilization_valid === false || x.pass === null)) { return null; }
  return u;
}
/** 이용률이 판정비가 아니다(utilization_valid: false · 전체 판정 없음 · 가정한 길이 — NG 아님) — 그 자리에 보이는 글. ref 가 있으면 그 수를 「참고」로 옆에 */
export function noVerdictRatio(why = '엔진이 utilization_valid: false 를 달았다 — 주 소요를 주지 않았거나 평가하지 못한 한계상태가 있어 이 비는 판정비가 아니다', ref: number | null = null): string {
  return `<span class="un" data-util-invalid${tip(why)}>판정 없음</span>${typeof ref === 'number' && Number.isFinite(ref) ? ` ${refRatio(ref, why)}` : ''}`;
}
/**
 * 전체 판정이 없다(NG 아님) — 이용률은 판정비가 아니다: 엔진의 utilization_valid: false, 결과의 pass 가 null(랩 · 접합의 「판정 없음」 —
 * 힘 분배 모델을 밝히지 않음 등), 가정한 길이(length_assumed)
 */
export const utilInvalid = (x: any): boolean => !!x && typeof x === 'object' && x.pass !== false
  && (x.utilization_valid === false || x.pass === null || x.length_assumed === true);
/** 결과가 엔진이 가정한 길이에서 나왔다(E-1 — `length_assumed: true`) */
export const lengthAssumed = (x: any): boolean => !!x && typeof x === 'object' && x.length_assumed === true;
export const LENGTH_ASSUMED_WHY = '엔진이 가정한 길이(빈 KxLx · KyLy · KtLt · Lb 를 엔진의 기본값으로 둠)로 낸 비다 — 참고값이며 합격도 불합격도 아니다(판정비가 아니다). 길이를 주면 판정';
/** 참고 비 — 판정비가 아닌 수(가정한 길이 · 판정 없음). data-ratio 를 달지 않는다(판정비로 세지 않게) — 값은 data-ratio-ref */
export function refRatio(r: number, why = LENGTH_ASSUMED_WHY): string {
  return `<span class="faint" data-ratio-ref="${r}"${tip(why)}>참고 ${ratioText(r, r > 1)}</span>`;
}

/** 엔진 판정(pass) → 글자 · 모양. true OK · false NG · 그 밖(null · 없음) 판정 없음/미검토 */
export function verdictOf(pass: unknown, unLabel = '미검토'): { text: string; cls: 'ok' | 'ng' | 'un' } {
  if (pass === true) { return { text: 'OK', cls: 'ok' }; }
  if (pass === false) { return { text: 'NG', cls: 'ng' }; }
  return { text: unLabel, cls: 'un' };
}

/** 판정비 구간색(템플릿 범례와 같은 구간) */
export function bandVar(r: number | null | undefined, ng: boolean): string {
  if (typeof r !== 'number' || !Number.isFinite(r)) { return 'var(--unchk)'; }
  if (ng || r > 1.25) { return 'var(--r6)'; }
  return r < 0.5 ? 'var(--r1)' : r < 0.75 ? 'var(--r2)' : r < 0.9 ? 'var(--r3)' : r <= 1 ? 'var(--r4)' : 'var(--r5)';
}

export function hhmm(at: number | string | undefined | null): string {
  if (at === undefined || at === null) { return ''; }
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) { return ''; }
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 엔진의 목록 항목(글 또는 {name, reason}) → 글 */
export function itemText(x: unknown): string {
  if (typeof x === 'string') { return x; }
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const name = o.name ?? o.check ?? o.item ?? '';
    const why = o.reason ?? o.why ?? o.message ?? '';
    return [name, why].filter(Boolean).map(String).join(' — ') || JSON.stringify(x);
  }
  return String(x ?? '');
}
