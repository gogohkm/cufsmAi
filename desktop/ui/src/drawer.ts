/**
 * 표 서랍 — 보기 아래의 표(그림 뒤의 수). 머리 칩으로 표를 고르고, 열 머리를 누르면 정렬, 「복사」는 탭으로 나눈 글(TSV).
 * 표의 수는 그림과 같은 출처 · 같은 `data-src`(format.ts)를 단다 — 시험이 MCP 와 대조한다.
 */
import { esc, tip } from './dom';

export interface Col { t: string; num?: boolean; tip?: string }
export interface DRow { key?: string; cls?: string; cells: string[]; sort: Array<string | number>; tsv: string[] }
export interface DTable { id: string; title: string; cols: Col[]; rows: DRow[]; note?: string; empty?: string }

const sortState = new Map<string, { col: number; dir: 1 | -1 }>();
let activeId: string | null = null;
let collapsed = false;

export function setActiveTable(id: string): void { activeId = id; }
export function toggleDrawer(): void { collapsed = !collapsed; }

function sorted(t: DTable): DRow[] {
  const s = sortState.get(t.id);
  if (!s) { return t.rows; }
  return [...t.rows].sort((a, b) => {
    const x = a.sort[s.col], y = b.sort[s.col];
    if (typeof x === 'number' && typeof y === 'number') { return (x - y) * s.dir; }
    return String(x ?? '').localeCompare(String(y ?? ''), 'ko') * s.dir;
  });
}

/** 서랍 HTML. tables 의 첫 것이 기본, 사용자가 고른 것이 있으면 그것 */
export function drawerHtml(tables: DTable[], opts: { sel?: string | null; collapsedDefault?: boolean } = {}): string {
  if (!tables.length) { return ''; }
  const t = tables.find(x => x.id === activeId) ?? tables[0];
  const closed = collapsed !== !!opts.collapsedDefault;
  const s = sortState.get(t.id);
  const head = t.cols.map((c, i) => `<th class="${c.num ? 'r' : ''}" data-sort="${i}"${tip(c.tip)}>${esc(c.t)}${s && s.col === i ? (s.dir > 0 ? ' ▴' : ' ▾') : ''}</th>`).join('');
  const body = t.rows.length ? sorted(t).map(r => `<tr${r.key ? ` data-k="${esc(r.key)}"` : ''} class="${r.cls ?? ''}${r.key && r.key === opts.sel ? ' on' : ''}">${r.cells.map((c, i) => `<td class="${t.cols[i]?.num ? 'r' : ''}">${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${t.cols.length}" class="none">${esc(t.empty ?? '결과 없음')}</td></tr>`;
  return `<div class="drawer${closed ? ' closed' : ''}" data-table-id="${esc(t.id)}">`
    + `<header><span class="dw-tg" data-drawer="toggle"${tip(closed ? '표 펼치기' : '표 접기')}>${closed ? '▸' : '▾'}</span><b>${esc(t.title)}</b>`
    + tables.map(x => `<span class="chip${x.id === t.id ? ' on' : ''}" data-dtab="${esc(x.id)}">${esc(x.title)} ${x.rows.length}</span>`).join('')
    + `<span class="sp"></span>${t.note ? `<span class="faint">${t.note}</span>` : ''}<button class="btn ghost" type="button" data-copy="${esc(t.id)}"${tip('이 표를 탭으로 나눈 글로 복사')}>복사</button></header>`
    + (closed ? '' : `<table class="t" data-table="${esc(t.id)}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`)
    + '</div>';
}

/** 열 머리 누르기 → 정렬(같은 열이면 방향을 바꾼다) */
export function sortBy(id: string, col: number): void {
  const s = sortState.get(id);
  sortState.set(id, { col, dir: s && s.col === col ? (s.dir === 1 ? -1 : 1) : 1 });
}

/** TSV — 머리 줄 + 정렬된 줄 */
export function tsvOf(t: DTable): string {
  return [t.cols.map(c => c.t).join('\t'), ...sorted(t).map(r => r.tsv.join('\t'))].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  (window as unknown as { __uiLastCopy?: string }).__uiLastCopy = text;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
