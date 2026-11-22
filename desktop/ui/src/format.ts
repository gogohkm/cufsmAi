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
