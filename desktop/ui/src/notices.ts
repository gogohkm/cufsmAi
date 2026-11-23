/**
 * 엔진의 글(경고 · 가정 · 범위 · 미검토 · 검토 항목의 이유 · 패스너 이름표) — 제품의 하나뿐인 그리기 `webview/js/notices.js`
 * (UMD `StcfsdNotices`, 보기 계약 4d · 검토 항목 계약 §16)를 그대로 묶어 부른다. 화면은 글을 고쳐 쓰지도 셈하지도 않는다.
 *
 *  - 말은 한국어(`text_ko` · `reason_ko` · 템플릿의 `template_ko`), 단위는 이 화면의 단위(SI) — 물리량 매개변수 · 템플릿에 박힌
 *    US 상수를 notices.js 가 바꾼다.
 *  - code 를 함께 둔다(`data-code` — get_view · focus · 기록이 가리킬 이름). 알림이 붙지 않은 옛 글(호스트가 더한 글 · 하위 묶음의 글)은
 *    같은 결과 나무 안의 알림을 글로 찾아 그 알림으로 그리고, 찾지 못하면 그 글 그대로(SI 면 그 안의 US 상수만 notices.js 가 바꾼다) — code 없음.
 */
// @ts-expect-error — UMD(CommonJS) 모듈, 형 정보 없음
import * as NX from '../../../webview/js/notices.js';

interface NoticesApi {
  render(n: unknown, opts: Opts): string;
  reason(c: unknown, opts: Opts): string | null;
  field(o: unknown, k: string, opts: Opts): unknown;
  forPage(tree: unknown, units: 'SI' | 'US'): any;
  readerCheck(c: unknown, opts: Opts): any;
  textMap(tree: unknown, opts: Opts): (s: string) => string;
  lines(result: unknown, opts: Opts & { lists?: string[] }): Array<{ list: string; code: string | null; kind: string; text: string; subject?: string }>;
  fastenerLabel(parts: unknown, opts: Opts, fallback?: string): string;
}
interface Opts { units: 'SI' | 'US'; lang: 'ko' | 'en' }
const N: NoticesApi = (typeof (NX as { render?: unknown }).render === 'function' ? NX : (NX as { default: NoticesApi }).default) as NoticesApi;
const O: Opts = { units: 'SI', lang: 'ko' };

/** 그린 글 하나와 그 알림의 code(없으면 null) */
export interface Note { text: string; code: string | null }

export type ListName = 'warnings' | 'assumptions' | 'scope_notes' | 'not_evaluated';

const isNotices = (v: unknown): v is any[] => Array.isArray(v)
  && v.some(n => n && typeof n === 'object' && ('template' in n || 'template_ko' in n || n.kind === 'group' || 'list' in n));

/** 결과 나무 안의 알림 — 옛 글(영어 원문) → 그린 글(notices.js 의 textMap — 찾지 못한 글은 그 라이브러리의 마지막 수단) · 그 알림의 code */
export type Finder = (s: string) => Note;
export function finder(tree: unknown): Finder {
  const tm = N.textMap(tree, O);
  const byText = new Map<string, any>();
  const gather = (o: any, depth: number): void => {
    if (!o || typeof o !== 'object' || depth > 40) { return; }
    if (Array.isArray(o)) { o.forEach(x => gather(x, depth + 1)); return; }
    if (isNotices(o.notices)) { o.notices.forEach((n: any) => { if (n && typeof n.text === 'string' && !byText.has(n.text)) { byText.set(n.text, n); } }); }
    for (const k of Object.keys(o)) { if ((k !== 'notices' || !isNotices(o[k])) && o[k] && typeof o[k] === 'object') { gather(o[k], depth + 1); } }
  };
  gather(tree, 0);
  return (s: string): Note => {
    const n = byText.get(s);
    return { text: tm(s), code: n && typeof n.code === 'string' ? n.code : null };
  };
}

const textOf = (x: unknown): string | null => (typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as any).reason === 'string'
  ? ((x as any).name ? `${String((x as any).name)} — ${String((x as any).reason)}` : String((x as any).reason)) : null);

/**
 * 결과 하나의 한 목록 → 그린 글(빈 글은 뺀다 — 예전 목록과 같이). 그 결과에 알림(`notices`)이 있으면 notices.js 의 `lines`(옛 글과 하나씩 맞춘다),
 * 없으면 옛 글마다 나무 안의 알림을 찾는다(`find`)
 */
export function noteList(result: any, list: ListName, find: Finder): Note[] {
  if (!result || typeof result !== 'object') { return []; }
  if (isNotices(result.notices)) {
    return N.lines(result, { ...O, lists: [list] }).map(l => ({ text: l.subject ? `${l.subject} — ${l.text}` : l.text, code: l.code ?? null })).filter(n => n.text || n.code);
  }
  const old = Array.isArray(result[list]) ? result[list] : [];
  return old.map((x: unknown) => {
    if (typeof x === 'string') { return find(x); }
    const o = x as any;
    if (o && typeof o === 'object' && typeof o.reason === 'string') {
      const r = find(o.reason);
      return { text: o.name ? `${String(o.name)} — ${r.text}` : r.text, code: r.code };
    }
    const t = textOf(x);
    return t === null ? { text: JSON.stringify(x), code: null } : find(t);
  }).filter((n: Note) => n.text || n.code);
}

/** 알림 체계 밖의 글 목록(not_checked …) — 나무 안에 같은 글의 알림이 있으면 그것으로, 없으면 그 글(SI 상수만 바꿈) */
export function looseList(v: unknown, find: Finder): Note[] {
  return Array.isArray(v) ? v.map(x => (typeof x === 'string' ? find(x) : textOf(x) !== null ? find(textOf(x)!) : { text: JSON.stringify(x), code: null })).filter(n => n.text || n.code) : [];
}

/** 검토 항목의 이유(`reason_*` — 한국어 · SI). 이유가 없으면 null */
export function reasonNote(check: any): Note | null {
  if (!check || typeof check !== 'object') { return null; }
  const t = N.reason(check, O);
  if (t === null || t === undefined || t === '') { return null; }
  return { text: t, code: typeof check.reason_code === 'string' ? check.reason_code : null };
}

/**
 * 글 필드 하나(`o[k]` — 옆 필드 `{k}_code · _template_ko · _params …` 가 있으면 그 알림을 한국어 · SI 로, 없으면 notices.js 의 마지막 수단).
 * 화면은 무늬 바꾸기를 부르지 않는다 — 이 함수가 라이브러리의 `field` 를 부른다
 */
export function fieldText(o: unknown, k: string): string {
  const v = N.field(o, k, O);
  return v === undefined || v === null ? '' : String(v);
}
/** 결과 하나의 글 필드 · 사전 · 모드 이름(`governing_check` 등 — 그 id 의 name_ko)을 그린 사본(notices.js forPage). 수는 그대로 */
export const pageOf = (result: unknown): any => (result && typeof result === 'object' ? N.forPage(result, 'SI') : result);
/** 검토 항목 하나의 읽는 꼴(이유 · 계산 과정의 note · 출처의 kind_ko · method_ko — notices.js readerCheck) */
export const readerOf = (check: unknown): any => (check && typeof check === 'object' ? N.readerCheck(check, O) : check);

/** 랩 패스너 이름표(`fastener_label_parts` — 볼트 d=12.7 mm). 없으면 옛 이름표 */
export function fastenerText(lap: any, fallback = '패스너'): string {
  if (!lap || typeof lap !== 'object') { return fallback; }
  const old = typeof lap.fastener_label === 'string' ? lap.fastener_label : '';
  const t = N.fastenerLabel(lap.fastener_label_parts, O, old);
  return t || (old ? fieldText(lap, 'fastener_label') : fallback);
}

/** `<li>` 하나 — 그린 글과 code */
export const noteLi = (n: Note, esc: (s: string) => string, attrs = ''): string => `<li${n.code ? ` data-code="${esc(n.code)}"` : ''}${attrs}>${esc(n.text)}</li>`;
