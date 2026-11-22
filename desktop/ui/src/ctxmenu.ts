/**
 * 우클릭 메뉴(템플릿 01 · 04 에 그린 것) — 「보는 일」과 사람만 하는 확인 표시만. 값 바꾸기 · 다시 실행은 없다.
 *
 * | 어디 | 메뉴 |
 * |---|---|
 * | 트리의 검토 항목 | 보기에서 찾기 F · 이 위치만 보기 I · 계산 시트 열기 Enter · 표에서 보기 · 확인 표시 Space(꺼짐 — R4) · 이름 복사 Ctrl+C |
 * | 트리의 무리 줄 | 모두 펼치기 · 모두 접기 · 표로 열기 |
 * | 트리의 그 밖 줄 | 보기에서 찾기 F · 표에서 보기 · 이름 복사 Ctrl+C |
 * | 정보 창 · 시트의 수 | 출처 보기 · 표에서 보기 · 복사 Ctrl+C |
 * | 표의 줄 | 보기에서 찾기 F · 행 복사 Ctrl+C · CSV 로 내보내기(클립보드로) |
 * | 그림 | 전체 맞춤 Home · 표시 항목 ▸ · 그림 복사(SVG 글) |
 */
import type { MenuItem } from './menu';

export interface MenuHandlers {
  find(key: string): void;
  onlyHere(key: string): void;
  sheet(key: string): void;
  table(key: string): void;
  copy(text: string, what: string): void;
  source(el: HTMLElement): void;
  expand(key: string, open: boolean): void;
  fit(zoomKey: string): void;
  showItems(dv: HTMLElement, x: number, y: number): void;
  copySvg(dv: HTMLElement): void;
  isCheck(key: string): boolean;
  hasSheet(key: string): boolean;
}

const RV_WHY = '내가 확인했다는 표시. 사람만 켠다 — 확인 기록은 R4 부터 남는다(지금은 꺼져 있다)';

/** 검토 항목 줄의 메뉴 */
export function checkMenu(key: string, name: string, h: MenuHandlers): MenuItem[] {
  return [
    { label: '보기에서 찾기', kbd: 'F', run: () => h.find(key) },
    { label: '이 위치만 보기', kbd: 'I', run: () => h.onlyHere(key) },
    '-',
    { label: '계산 시트 열기', kbd: 'Enter', run: () => h.sheet(key), off: !h.hasSheet(key), why: '이 항목은 엔진의 검토 항목(design_checks)이 아니다 — 계산 과정이 없다' },
    { label: '표에서 보기', run: () => h.table(key) },
    '-',
    { label: '확인 표시', kbd: 'Space', run: () => h.copy('', 'rv'), off: true, why: RV_WHY },
    { label: '이름 복사', kbd: 'Ctrl+C', run: () => h.copy(name, '이름') },
  ];
}

/** 이벤트 자리 → 메뉴(없으면 null — 브라우저 기본 메뉴도 막는다) */
export function menuAt(t: HTMLElement, h: MenuHandlers, x: number, y: number): { items: MenuItem[]; title: string } | null {
  const row = t.closest('#tree .row') as HTMLElement | null;
  if (row) {
    const key = row.getAttribute('data-k') ?? '';
    const name = row.querySelector('.nm')?.textContent ?? '';
    if (h.isCheck(key)) { return { items: checkMenu(key, name, h), title: name }; }
    const group = !!row.querySelector('.tw')?.textContent;
    if (group) {
      return { title: name, items: [
        { label: '모두 펼치기', run: () => h.expand(key, true) },
        { label: '모두 접기', run: () => h.expand(key, false) },
        { label: '표로 열기', run: () => h.table(key) },
      ] };
    }
    return { title: name, items: [
      { label: '보기에서 찾기', kbd: 'F', run: () => h.find(key) },
      { label: '표에서 보기', run: () => h.table(key) },
      '-',
      { label: '이름 복사', kbd: 'Ctrl+C', run: () => h.copy(name, '이름') },
    ] };
  }
  const val = t.closest('#info [data-src], #sheet [data-src]') as HTMLElement | null;
  if (val) {
    const key = (val.closest('tr[data-k], [data-card]') as HTMLElement | null)?.getAttribute('data-k') ?? (val.closest('[data-card]') as HTMLElement | null)?.getAttribute('data-card') ?? '';
    const unit = val.nextElementSibling?.classList.contains('u') ? ` ${val.nextElementSibling.textContent ?? ''}` : '';
    return { title: '', items: [
      { label: '출처 보기', run: () => h.source(val) },
      { label: '표에서 보기', run: () => h.table(key), off: !key, why: '이 값은 표의 한 줄이 아니다' },
      '-',
      { label: '복사', kbd: 'Ctrl+C', run: () => h.copy(`${val.textContent ?? ''}${unit}`.trim(), '값') },
    ] };
  }
  const tr = t.closest('.drawer tbody tr, #info tbody tr, #center table.vt tr.ck') as HTMLElement | null;
  if (tr) {
    const key = tr.getAttribute('data-k') ?? '';
    const cells = [...tr.children].map(c => (c.textContent ?? '').trim());
    return { title: '', items: [
      { label: '보기에서 찾기', kbd: 'F', run: () => h.find(key), off: !key, why: '이 줄은 보기의 한 자리가 아니다' },
      '-',
      { label: '행 복사', kbd: 'Ctrl+C', run: () => h.copy(cells.join('\t'), '행') },
      { label: 'CSV 로 내보내기', run: () => h.copy(cells.map(c => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','), 'CSV 한 줄') },
    ] };
  }
  const dv = t.closest('#center .dv') as HTMLElement | null;
  if (dv) {
    const zk = dv.getAttribute('data-zoom') ?? '';
    return { title: '', items: [
      { label: '전체 맞춤', kbd: 'Home', run: () => h.fit(zk), off: !zk, why: '이 보기는 확대하지 않는다' },
      { label: '표시 항목', kbd: '▸', run: () => h.showItems(dv, x, y) },
      '-',
      { label: '그림 복사', run: () => h.copySvg(dv), off: !dv.querySelector('svg'), why: '그림(SVG)이 없는 보기' },
    ] };
  }
  return null;
}
