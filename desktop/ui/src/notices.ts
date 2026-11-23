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

/** 결과 나무 안의 알림 — 옛 글(영어 원문) → 알림. 같은 글은 처음 것 */
export type Finder = (s: string) => Note;
export function finder(tree: unknown): Finder {
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
    return n ? { text: N.render(n, O), code: typeof n.code === 'string' ? n.code : null } : { text: N.render(s, O), code: null };
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
    return { text: t === null ? JSON.stringify(x) : N.render(t, O), code: null };
  }).filter((n: Note) => n.text || n.code);
}

/** 알림 체계 밖의 글 목록(not_checked …) — 나무 안에 같은 글의 알림이 있으면 그것으로, 없으면 그 글(SI 상수만 바꿈) */
export function looseList(v: unknown, find: Finder): Note[] {
  return Array.isArray(v) ? v.map(x => (typeof x === 'string' ? find(x) : { text: N.render(textOf(x) ?? JSON.stringify(x), O), code: null })).filter(n => n.text || n.code) : [];
}

/** 검토 항목의 이유(`reason_*` — 한국어 · SI). 이유가 없으면 null */
export function reasonNote(check: any): Note | null {
  if (!check || typeof check !== 'object') { return null; }
  const t = N.reason(check, O);
  if (t === null || t === undefined || t === '') { return null; }
  return { text: t, code: typeof check.reason_code === 'string' ? check.reason_code : null };
}

/** 글 하나(구조가 없는 엔진 · 호스트 글) — SI 면 그 안의 US 상수만 바꾼다 */
export const plainText = (s: unknown): string => N.render(String(s ?? ''), O);

/** 랩 패스너 이름표(`fastener_label_parts` — 볼트 d=12.7 mm). 없으면 옛 이름표 */
export function fastenerText(lap: any, fallback = '패스너'): string {
  if (!lap || typeof lap !== 'object') { return fallback; }
  const old = typeof lap.fastener_label === 'string' ? lap.fastener_label : '';
  const t = N.fastenerLabel(lap.fastener_label_parts, O, old);
  return t || (old ? plainText(old) : fallback);
}

/** `<li>` 하나 — 그린 글과 code */
export const noteLi = (n: Note, esc: (s: string) => string, attrs = ''): string => `<li${n.code ? ` data-code="${esc(n.code)}"` : ''}${attrs}>${esc(n.text)}</li>`;
