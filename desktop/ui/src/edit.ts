/**
 * 편집 상태(F2) — 지금의 설계 화면(탭 6개)을 `<iframe>` 으로 끼워 둔다. 페이지가 뜰 때부터 끝까지 붙어 있고(숨김),
 * 편집 상태에서만 가운데 + 오른쪽 자리에 보인다. 설계 탭 입력 · 검증 · 보고서는 K2 · K3 전까지 이 화면에만 있으므로,
 * 숨겨져 있어도 떼지 않는다 — 첫 배포판이 하던 일은 모두 여기서 그대로 된다. 다듬는 것은 U4 의 일이다.
 *
 * 두 번째 웹뷰(좌굴 보고서)는 틀과 같이 오른쪽 칸에 띄우고 ✕ 로 호스트에 닫기를 보낸다.
 *
 * 끼운 웹뷰는 다리의 웹뷰 서버(다른 출처)에서 돈다 — 그 문서에 직접 닿지 않고 postMessage 로만 말한다(V5-04 · V5-18):
 * 웹뷰가 `need-key` 를 물으면 이 화면의 iframe 일 때만 웹뷰 열쇠(`/api/wv-key`)를 건네고, 테마 · 「열기」 · 「저장」 단추는
 * 메시지로 보낸다. 웹뷰 안에서 누른 F2 는 웹뷰가 메시지로 알려 준다.
 */
import { api, keyHeaders } from './bridge';

let on = false;
let designerSrc = '';
let sideId: string | null = null;
let theme: 'dark' | 'light' = 'dark';
let changed: () => void = () => undefined;
let wvOrigin: string | null = null;
let wvKey: string | null = null;
let keyWaiters: Array<(k: string) => void> = [];
let keyAsked = false;
let onF2: () => void = () => undefined;

function frames(): HTMLIFrameElement[] {
  return ['designer', 'side-frame'].map(id => document.getElementById(id) as HTMLIFrameElement | null).filter((f): f is HTMLIFrameElement => !!f);
}
function withKey(cb: (k: string) => void): void {
  if (wvKey) { cb(wvKey); return; }
  keyWaiters.push(cb);
  if (keyAsked) { return; }
  keyAsked = true;
  void fetch('/api/wv-key', { headers: keyHeaders(), credentials: 'same-origin' }).then(r => r.json()).then((r: any) => {
    keyAsked = false;
    if (!r?.success) { return; }
    const k = String(r.data.key);
    wvKey = k;
    const w = keyWaiters; keyWaiters = [];
    for (const f of w) { f(k); }
  }).catch(() => { keyAsked = false; });
}
/** 다리의 웹뷰 서버 출처(상태의 webviewOrigin) */
export function setWebviewOrigin(o: string | null | undefined): void { wvOrigin = o || null; }
/** 끼운 웹뷰 안에서 누른 F2 */
export function onWebviewF2(cb: () => void): void { onF2 = cb; }
/** 끼운 웹뷰(설계 · 보고서)에 메시지 — 다리의 수신부가 받는다 */
export function postToWebviews(msg: Record<string, unknown>, only?: 'designer'): boolean {
  if (!wvOrigin) { return false; }
  let sent = false;
  for (const f of frames()) {
    if (only && f.id !== only) { continue; }
    try { if (f.contentWindow && f.src && f.src !== 'about:blank') { f.contentWindow.postMessage({ stcfsdBridge: 1, ...msg }, wvOrigin); sent = true; } } catch { /* 아직 */ }
  }
  return sent;
}

let wired = false;
export function initEdit(t: 'dark' | 'light', onChange: () => void): void {
  theme = t;
  changed = onChange;
  if (wired) { return; }
  wired = true;
  window.addEventListener('message', e => {
    const d = e.data as { stcfsdBridge?: number; type?: string; key?: string } | null;
    if (!d || d.stcfsdBridge !== 1 || !wvOrigin || e.origin !== wvOrigin) { return; }
    const from = frames().find(f => f.contentWindow === e.source);
    if (!from) { return; }
    if (d.type === 'need-key') {
      const src = e.source as Window;
      const target = wvOrigin;
      withKey(k => { try { src.postMessage({ stcfsdBridge: 1, type: 'key', key: k }, target); } catch { /* 닫힘 */ } });
    } else if (d.type === 'keydown' && d.key === 'F2' && from.id === 'designer') {
      onF2();
    }
  });
  document.getElementById('side-close')?.addEventListener('click', () => {
    if (!sideId) { return; }
    const id = sideId;
    void api('POST', `/api/webviews/${encodeURIComponent(id)}/close`, {}).then(() => hideSide(id));
  });
}

export function editing(): boolean { return on; }

/** 다음에 싣는 웹뷰(보고서)의 테마 */
export function setEditTheme(t: 'dark' | 'light'): void { theme = t; }

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
