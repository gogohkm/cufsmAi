/**
 * 작은 펼침 목록(제목 표시줄의 「검토 대상 ▾」). 실제로 되는 항목만 받는다. (StAnal ui/src/menu.ts 를 줄임)
 * 우클릭 메뉴는 U3 의 일이다 — 여기에는 없다.
 */
import { esc } from './dom';

export type MenuItem = '-' | { label: string; kbd?: string; run: () => void };

let live: HTMLElement | null = null;

export function closeMenu(): boolean {
  const had = !!live;
  live?.remove();
  live = null;
  return had;
}

export function openMenu(items: MenuItem[], x: number, y: number, title?: string): HTMLElement {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'ctx';
  m.setAttribute('role', 'menu');
  m.innerHTML = (title ? `<div class="ct">${esc(title)}</div>` : '') + items.map((it, i) => (it === '-' ? '<hr>'
    : `<div class="ci" role="menuitem" data-i="${i}"><span>${esc(it.label)}</span><kbd>${esc(it.kbd ?? '')}</kbd></div>`)).join('');
  m.addEventListener('mousedown', e => e.stopPropagation());
  m.addEventListener('click', e => {
    e.stopPropagation();
    const ci = (e.target as HTMLElement).closest('.ci');
    const it = ci ? items[Number(ci.getAttribute('data-i'))] : undefined;
    if (!it || it === '-') { return; }
    closeMenu();
    it.run();
  });
  document.body.appendChild(m);
  live = m;
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 6))}px`;
  m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 6))}px`;
  return m;
}

export function installMenuClosers(): void {
  document.addEventListener('mousedown', () => closeMenu());
  window.addEventListener('blur', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); } });
}
