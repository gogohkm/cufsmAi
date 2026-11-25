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
import { esc, tip } from './dom';
import { LENGTH_BOUND_WHY, lengthBoundFailure, type LengthBound, lengthAssumed, LENGTH_ASSUMED_WHY, noVerdictRatio, ratio, refRatio, utilInvalid, utilShown } from './format';

interface NoticesApi {
  render(n: unknown, opts: Opts): string;
  reason(c: unknown, opts: Opts): string | null;
  field(o: unknown, k: string, opts: Opts): unknown;
  forPage(tree: unknown, units: 'SI' | 'US'): any;
  readerCheck(c: unknown, opts: Opts): any;
  textMap(tree: unknown, opts: Opts): (s: string) => string;
  HOST: Record<string, unknown>;
  RESULT_KINDS_KO: Record<string, string>;
  hostNotice(code: string, values?: Record<string, unknown>): unknown;
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

/**
 * 전체 판정이 없는 까닭(풍선) — 가정한 길이(E-1)면 그것, 아니면 엔진이 평가하지 못한 검토 항목(이름 — 이유, 셋까지 — 랩의 「힘 분배 모델을
 * 밝히지 않음」 도 여기). 화면은 까닭을 짓지 않는다 — 엔진의 글 그대로
 */
export function noVerdictWhy(x: any): string {
  if (lengthAssumed(x)) { return LENGTH_ASSUMED_WHY; }
  const ne = (Array.isArray(x?.design_checks) ? x.design_checks : []).filter((c: any) => c && c.verdict === 'not_evaluated' && c.counts !== false);
  if (ne.length) {
    const t = ne.slice(0, 3).map((c: any) => `${String(c.name_ko ?? c.name ?? c.id)}${(r => (r ? ` — ${r.text}` : ''))(reasonNote(c))}`).join(' · ');
    return `전체 판정이 없다 — 평가하지 못한 항목 ${ne.length}: ${t}${ne.length > 3 ? ' …' : ''}. 이 비는 평가한 항목 가운데의 비일 뿐 판정비가 아니다`;
  }
  if (x?.utilization_valid === false) { return '엔진이 utilization_valid: false 를 달았다 — 주 소요를 주지 않았거나 평가하지 못한 한계상태가 있어 이 비는 판정비가 아니다'; }
  return '전체 판정이 없다(엔진의 pass: null) — 이 비는 평가한 항목 가운데의 비일 뿐 판정비가 아니다';
}

/**
 * 결과 하나의 머리 비 — 판정비 · 「판정 없음」(그 까닭) · 가정한 길이의 참고 비. `u` 는 보일 수(SI 로 바꾼 것), `src` 는 data-src.
 * 판정은 엔진의 pass 그대로(화면이 짓지 않는다)
 */
export function utilHtml(x: any, u: unknown, src: string, fallback = ''): string {
  const lb = lengthBoundFailure(x);
  if (lb) { return lengthBoundHtml(x, lb, src.replace(/utilization$/, lb.path), typeof u === 'number' && Number.isFinite(u) ? u : null); }
  const shown = utilShown(x, u);
  if (shown !== null) { return ratio(shown, x?.pass === false, src); }
  const ref = lengthAssumed(x) && typeof u === 'number' && Number.isFinite(u) ? u : null;
  if (utilInvalid(x)) { return noVerdictRatio(noVerdictWhy(x), ref); }
  if (ref !== null) { return refRatio(ref); }
  return fallback;
}

/** 길이와 상관없는 하한의 항목 이름(그 id 의 name_ko — 엔진의 design_checks). 없으면 id 그대로 */
export function boundCheckName(x: any, lb: LengthBound): string {
  const c = (Array.isArray(x?.design_checks) ? x.design_checks : []).find((d: any) => d && d.id === lb.check);
  return String(c?.name_ko ?? c?.name ?? lb.check ?? '길이와 상관없는 하한');
}
export const ASSUMED_REF_WHY = '가정한 길이(빈 길이를 엔진의 기본값으로 둠)로 낸 이용률 — 참고값. 판정은 길이와 상관없는 하한으로 났다';
/**
 * 하한으로 NG 인 결과의 머리 비 — 하한의 비(NG 판정비) · 그 한계상태 · 가정한 길이의 이용률은 「참고」(utils.js lengthBoundFailure 와 같은 뜻).
 * src = 하한 비의 data-src, ref = 가정한 길이의 이용률(보일 수)
 */
export function lengthBoundHtml(x: any, lb: LengthBound, src: string, ref: number | null): string {
  const nm = boundCheckName(x, lb);
  const why = `${LENGTH_BOUND_WHY} — 한계상태 ${nm}${lb.limitState ? ` (${lb.limitState})` : ''}`;
  return `${ratio(lb.ratio, true, src)} <span class="why" data-length-bound="${esc(lb.check ?? '')}"${tip(why)}>하한 · ${esc(nm)}</span>`
    + (ref !== null ? ` ${refRatio(ref, ASSUMED_REF_WHY)}` : '');
}

/**
 * R2 — 랩 패스너의 힘 분배(force_model: 자체 가정 — 모델 A, 모든 패스너가 고르게). 사람이 그 모델로 판정한다고 밝혔는가는 엔진이 결과에
 * 적은 `force_model.confirmed`(입력 lap_force_model_confirmed · 화면 칸 lapForceModelConfirmed) 그대로. 그 키가 없는 옛 결과는 null
 */
export const forceModelConfirmed = (x: any): boolean | null => {
  const c = x?.force_model?.confirmed;
  return c === true ? true : c === false ? false : null;
};
/** 밝히지 않은 모델 A 로 낸 결과인가(패스너 무리 · 개수는 「평가하지 못함」 — 모델 A 로도 넘을 때만 NG) */
export const unconfirmedModel = (x: any): boolean => forceModelConfirmed(x) === false;
export const FORCE_MODEL_WHY = '패스너 힘 분배를 「모든 패스너가 고르게 나눔」(모델 A — 자체 가정, 기준에 식 없음)으로 판정한다고 사람이 밝히지 않았다 — '
  + '이 비는 그 모델로 낸 참고값이다. 패스너 무리 · 개수는 그 모델로도 넘을 때만 NG, 아니면 평가하지 못함(판정 없음). 밝히는 칸: 모델 › 접합부 › 랩 접합 「힘 분배 모델 확인」';
/** 「자체 가정」 꼬리표 — 사람이 그 모델을 밝혔는지까지(엔진의 force_model.confirmed). 자체 가정이 아니면 '' */
export function forceModelTag(x: any, compact = false): string {
  const fm = x?.force_model;
  if (!fm || typeof fm !== 'object' || fm.specification_provision !== false) { return ''; }
  const c = forceModelConfirmed(x);
  const base = '기준 조항이 아닌 자체 해석(§A1.2(c)) — 패스너 힘 분배 모델 A(모든 패스너가 고르게)';
  const t = c === true ? `${base}. 사람이 그 모델로 판정한다고 밝혔다(lapForceModelConfirmed) — 패스너 무리 · 개수를 그 모델로 판정했다`
    : c === false ? `${base}. 사람이 밝히지 않았다 — 패스너 무리 · 개수는 그 모델로도 넘을 때만 NG, 아니면 평가하지 못함(판정 없음). 밝히는 칸: 모델 › 접합부 › 랩 접합 「힘 분배 모델 확인」`
      : base;
  const label = compact ? (c === true ? '가정 확인' : c === false ? '가정 미확인' : '자체 가정') : c === true ? '자체 가정 · 확인함' : c === false ? '자체 가정 · 확인 안 함' : '자체 가정';
  return `<span class="tag def" data-force-model="${c === true ? 'confirmed' : c === false ? 'unconfirmed' : 'unknown'}"${tip(t)}>${label}</span>`;
}

/**
 * R4 — 하중 해석이 쓴 하중조합의 기준(엔진 결과의 `load_combination_standard` — edition · reference, 고른 때만 key · allowed ·
 * unchanged_by_selection). key 가 없으면 고르지 않은 처음 값(asce7_10 — 그 판의 결과 그대로). 그 키가 없는 옛 결과는 null
 */
export function comboStandard(la: any): { edition: string; key: string | null; reference: string; unchanged: string[] } | null {
  const s = la?.load_combination_standard;
  if (!s || typeof s !== 'object') { return null; }
  return { edition: String(s.edition ?? ''), key: typeof s.key === 'string' ? s.key : null, reference: s.reference !== undefined ? fieldText(s, 'reference') : '',
    unchanged: Array.isArray(s.unchanged_by_selection) ? s.unchanged_by_selection.map(String) : [] };
}
const UNCHANGED_KO: Record<string, string> = { deflection: '처짐', deflection_cases: '처짐 경우', pattern_loading: '패턴 재하' };
export const comboStandardTip = (c: { key: string | null; reference: string; unchanged: string[] }): string =>
  `${c.reference ? `${c.reference} · ` : ''}${c.key ? `검토 상태의 「하중조합 기준」 ${c.key}` : '고르지 않음 — 처음 값(asce7_10, 지금까지의 결과 그대로)'}`
  + `${c.unchanged.length ? ` · 기준을 골라도 바뀌지 않는 것: ${c.unchanged.map(u => UNCHANGED_KO[u] ?? u).join(' · ')}` : ''}`;

/** 랩 패스너 이름표(`fastener_label_parts` — 볼트 d=12.7 mm). 없으면 옛 이름표 */
export function fastenerText(lap: any, fallback = '패스너'): string {
  if (!lap || typeof lap !== 'object') { return fallback; }
  const old = typeof lap.fastener_label === 'string' ? lap.fastener_label : '';
  const t = N.fastenerLabel(lap.fastener_label_parts, O, old);
  return t || (old ? fieldText(lap, 'fastener_label') : fallback);
}

/** 호스트의 글(`host.*` code — 화면은 그 한국어). 그 code 가 표에 없으면 '' */
export function hostText(code: unknown, values: Record<string, unknown> = {}): string {
  if (typeof code !== 'string' || !N.HOST || !N.HOST[code]) { return ''; }
  try { return N.render(N.hostNotice(code, values), O); } catch { return ''; }
}

/** 결과 종류의 한국어 이름(공유 표) */
export const resultKindKo = (k: string): string => (N.RESULT_KINDS_KO && N.RESULT_KINDS_KO[k]) || k;

/** `<li>` 하나 — 그린 글과 code */
export const noteLi = (n: Note, esc: (s: string) => string, attrs = ''): string => `<li${n.code ? ` data-code="${esc(n.code)}"` : ''}${attrs}>${esc(n.text)}</li>`;
