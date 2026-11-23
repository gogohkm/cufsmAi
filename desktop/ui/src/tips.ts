/** 풍선 도움말 — data-tip 을 가진 것 위에 커서를 올리면 뜬다. 화면에 안내 문장을 쓰지 않는 대신이다. (StAnal ui/src/tips.ts) */
import { bidiSafe } from './dom';

let box: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let target: Element | null = null;

function hide(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  box?.remove();
  box = null;
  target = null;
}

function show(t: Element, text: string): void {
  box = document.createElement('div');
  box.className = 'tipbox';
  box.setAttribute('role', 'tooltip');
  box.textContent = bidiSafe(text);
  document.body.appendChild(box);
  const r = t.getBoundingClientRect();
  box.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - box.offsetWidth - 6))}px`;
  const below = r.bottom + 6;
  box.style.top = `${below + box.offsetHeight > window.innerHeight ? r.top - box.offsetHeight - 6 : below}px`;
}

/** 요소 옆에 잠깐 풍선을 띄운다 */
export function flashTip(anchor: HTMLElement, text: string, ms = 1800): void {
  hide();
  show(anchor, text);
  timer = setTimeout(hide, ms);
}

export function installTips(): void {
  document.addEventListener('mouseover', e => {
    const t = (e.target as Element | null)?.closest?.('[data-tip]') ?? null;
    if (t === target) { return; }
    hide();
    if (!t) { return; }
    target = t;
    timer = setTimeout(() => {
      const text = t.getAttribute('data-tip');
      if (text && document.body.contains(t)) { show(t, text); }
    }, 280);
  });
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('scroll', hide, true);
}
