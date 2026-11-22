/** DOM 도우미 — 호스트 · 엔진의 글은 언제나 esc() 를 거쳐 innerHTML 에 들어간다. (StAnal ui/src/dom.ts 를 옮김) */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);
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
