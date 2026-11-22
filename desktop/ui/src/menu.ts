/**
 * 작은 펼침 목록 — 제목 표시줄의 「검토 대상 ▾」과 우클릭 메뉴(U3, ctxmenu.ts). 실제로 되는 항목만 받는다(StAnal ui/src/menu.ts 를 줄임).
 * 꺼진 항목(`off`)은 보이되 누르면 까닭만 알린다(예: 「확인 표시」 — 기록 R4 전). 키보드: ↑ ↓ 로 고르고 Enter, Esc 로 닫는다.
 */
import { esc, tip } from './dom';

export type MenuItem = '-' | { label: string; kbd?: string; run: () => void; off?: boolean; why?: string };

let live: HTMLElement | null = null;
let items: MenuItem[] = [];
let cur = -1;

export function closeMenu(): boolean {
  const had = !!live;
  live?.remove();
  live = null;
  cur = -1;
  return had;
}
export const menuOpen = (): boolean => !!live;

function mark(): void {
  live?.querySelectorAll('.ci').forEach(el => el.classList.toggle('sel', Number(el.getAttribute('data-i')) === cur));
}

function runAt(i: number): void {
  const it = items[i];
  if (!it || it === '-') { return; }
  closeMenu();
  it.run();
}

export function openMenu(list: MenuItem[], x: number, y: number, title?: string): HTMLElement {
  closeMenu();
  items = list;
  const m = document.createElement('div');
  m.className = 'ctx';
  m.setAttribute('role', 'menu');
  m.innerHTML = (title ? `<div class="ct">${esc(title)}</div>` : '') + list.map((it, i) => (it === '-' ? '<hr>'
    : `<div class="ci${it.off ? ' off' : ''}" role="menuitem" data-i="${i}"${it.off ? ` aria-disabled="true"${tip(it.why)}` : ''}><span>${esc(it.label)}</span><kbd>${esc(it.kbd ?? '')}</kbd></div>`)).join('');
  m.addEventListener('mousedown', e => e.stopPropagation());
  m.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  m.addEventListener('click', e => {
    e.stopPropagation();
    const ci = (e.target as HTMLElement).closest('.ci');
    if (ci) { runAt(Number(ci.getAttribute('data-i'))); }
  });
  document.body.appendChild(m);
  live = m;
  m.style.left = `${Math.max(4, Math.min(x, window.innerWidth - m.offsetWidth - 6))}px`;
  m.style.top = `${Math.max(4, Math.min(y, window.innerHeight - m.offsetHeight - 6))}px`;
  return m;
}

/** 메뉴가 열려 있을 때의 키 — 다룬 키면 true */
export function menuKey(e: KeyboardEvent): boolean {
  if (!live) { return false; }
  const idx = items.map((it, i) => (it === '-' ? -1 : i)).filter(i => i >= 0);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const p = idx.indexOf(cur);
    cur = e.key === 'ArrowDown' ? idx[(p + 1) % idx.length] : idx[(p - 1 + idx.length) % idx.length];
    mark();
    return true;
  }
  if (e.key === 'Enter') { if (cur >= 0) { runAt(cur); } else { closeMenu(); } return true; }
  if (e.key === 'Escape') { closeMenu(); return true; }
  return false;
}

export function installMenuClosers(): void {
  document.addEventListener('mousedown', () => closeMenu());
  window.addEventListener('blur', () => closeMenu());
  window.addEventListener('resize', () => closeMenu());
}
