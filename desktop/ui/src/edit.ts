/**
 * 편집 상태(F2) — 지금의 설계 화면(탭 6개)을 `<iframe>` 으로 끼워 둔다. 페이지가 뜰 때부터 끝까지 붙어 있고(숨김),
 * 편집 상태에서만 가운데 + 오른쪽 자리에 보인다. 설계 탭 입력 · 검증 · 보고서는 K2 · K3 전까지 이 화면에만 있으므로,
 * 숨겨져 있어도 떼지 않는다 — 첫 배포판이 하던 일은 모두 여기서 그대로 된다. 다듬는 것은 U4 의 일이다.
 *
 * 두 번째 웹뷰(좌굴 보고서)는 틀과 같이 오른쪽 칸에 띄우고 ✕ 로 호스트에 닫기를 보낸다.
 */
import { api } from './bridge';

let on = false;
let designerSrc = '';
let sideId: string | null = null;
let theme: 'dark' | 'light' = 'dark';
let changed: () => void = () => undefined;

let wired = false;
export function initEdit(t: 'dark' | 'light', onChange: () => void): void {
  theme = t;
  changed = onChange;
  if (wired) { return; }
  wired = true;
  document.getElementById('side-close')?.addEventListener('click', () => {
    if (!sideId) { return; }
    const id = sideId;
    void api('POST', `/api/webviews/${encodeURIComponent(id)}/close`, {}).then(() => hideSide(id));
  });
}

export function editing(): boolean { return on; }

/** 설계 웹뷰를 붙인다(한 번). 다리의 /wv/<id>/ — 그 페이지가 호스트 ↔ 웹뷰 통로를 쥔다 */
export function mountDesigner(url: string): void {
  const src = `${url}?theme=${theme}`;
  if (designerSrc === src) { return; }
  designerSrc = src;
  (document.getElementById('designer') as HTMLIFrameElement).src = src;
}

export function setEditing(v: boolean): void {
  on = v;
  document.getElementById('review')?.classList.toggle('editing', on);
  const pane = document.getElementById('edit')!;
  pane.setAttribute('aria-hidden', String(!on));
  if (on) { (document.getElementById('designer') as HTMLIFrameElement).focus(); }
  changed();
}

export function toggleEditing(): void { setEditing(!on); }

export function showSide(w: { id: string; title?: string; viewType?: string; url: string }): void {
  sideId = w.id;
  document.getElementById('side-title')!.textContent = w.title || w.viewType || '';
  (document.getElementById('side-frame') as HTMLIFrameElement).src = `${w.url}?theme=${theme}`;
  document.getElementById('side')!.hidden = false;
}

export function hideSide(id?: string): void {
  if (id && id !== sideId) { return; }
  sideId = null;
  document.getElementById('side')!.hidden = true;
  (document.getElementById('side-frame') as HTMLIFrameElement).src = 'about:blank';
}

export function reloadSide(id: string): void {
  if (id !== sideId) { return; }
  const f = document.getElementById('side-frame') as HTMLIFrameElement;
  f.src = f.src;
}
