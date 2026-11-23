/** DOM 도우미 — 호스트 · 엔진의 글은 언제나 esc() 를 거쳐 innerHTML 에 들어간다. (StAnal ui/src/dom.ts 를 옮김) */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * 글 방향 제어 문자(LRM · RLM · LRE … RLO · LRI … PDI · ALM) — 파일 이름 · 엔진 글 · 알림이 거꾸로 읽히게(「txt.exe」를 「exe.txt」처럼)
 * 하지 못하게 보이는 대체 문자 U+FFFD 로 바꾼다. 호스트의 그리기(webview/js/reportRender.js esc)와 같은 규칙
 */
const BIDI = /[‎‏‪-‮⁦-⁩؜]/g;
export function bidiSafe(v: unknown): string { return String(v ?? '').replace(BIDI, '�'); }

export function esc(v: unknown): string {
  return bidiSafe(v).replace(/[&<>"']/g, c => ESC[c]);
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) { throw new Error(`화면 요소가 없다: ${sel}`); }
  return e as HTMLElement;
}

/** `data-tip` 속성 조각(값이 없으면 빈 문자열) */
export function tip(text: string | undefined | null): string {
  return text ? ` data-tip="${esc(text)}"` : '';
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) { clearTimeout(t); }
    t = setTimeout(() => { t = undefined; fn(...a); }, ms);
  };
}
