/**
 * 편집 상태(F2 · 「편집 F2」 — 템플릿 09) — 지금의 설계 화면(탭 6개)을 `<iframe>` 으로 끼워 둔다. 페이지가 뜰 때부터 끝까지 붙어 있고(숨김),
 * 편집 상태에서만 가운데 + 오른쪽 자리에 보인다(트리 · 제목 줄은 그대로, 그 아래 「이번 편집」 띠). 칸을 고치면 호스트의 검토 상태가 바뀌고(K2)
 * 이 화면의 트리 · 정보 창 · 시트 · 진행 띠가 곧바로 따라온다 — 둘 다 호스트를 읽는다. 검증 · 보고서는 K3 전까지 이 화면에만 있다.
 * 마치기: F2 · 「편집 마치기 F2」 · Esc(설계 화면 안에서도 — 칸 밖일 때). 돌아오면 고른 것 · 보기는 그대로다.
 *
 * 두 번째 웹뷰(좌굴 보고서)는 틀과 같이 오른쪽 칸에 띄우고 ✕ 로 호스트에 닫기를 보낸다.
 *
 * 끼운 웹뷰는 다리의 웹뷰 서버(다른 출처)에서 돈다 — 그 문서에 직접 닿지 않고 postMessage 로만 말한다(V5-04 · V5-18):
 * 웹뷰가 `need-key` 를 물으면 이 화면의 iframe 일 때만 웹뷰 열쇠(`/api/wv-key`)를 건네고, 테마 · 「열기」 · 「저장」 단추는
 * 메시지로 보낸다. 웹뷰 안에서 누른 F2 는 웹뷰가 메시지로 알려 준다.
 */
import { api, keyHeaders } from './bridge';
import { bidiSafe } from './dom';

let on = false;
let designerSrc = '';
let sideId: string | null = null;
let theme: 'dark' | 'light' = 'dark';
let changed: () => void = () => undefined;
let wvOrigin: string | null = null;
/** 웹뷰 열쇠는 웹뷰마다(V5b-06) — 웹뷰 id → 열쇠 · 기다리는 것 */
const wvKeys = new Map<string, string>();
const keyWaiters = new Map<string, Array<(k: string) => void>>();
let onF2: () => void = () => undefined;

function frames(): HTMLIFrameElement[] {
  return ['designer', 'side-frame'].map(id => document.getElementById(id) as HTMLIFrameElement | null).filter((f): f is HTMLIFrameElement => !!f);
}
function withKey(id: string, cb: (k: string) => void): void {
  const have = wvKeys.get(id);
  if (have) { cb(have); return; }
  const waiting = keyWaiters.get(id);
  if (waiting) { waiting.push(cb); return; }
  keyWaiters.set(id, [cb]);
  void fetch(`/api/wv-key?id=${encodeURIComponent(id)}`, { headers: keyHeaders(), credentials: 'same-origin' }).then(r => r.json()).then((r: any) => {
    const w = keyWaiters.get(id) ?? []; keyWaiters.delete(id);
    if (!r?.success) { return; }
    const k = String(r.data.key);
    wvKeys.set(id, k);
    for (const f of w) { f(k); }
  }).catch(() => { keyWaiters.delete(id); });
}
/** 이 iframe 에 이 화면이 실은 웹뷰의 id — iframe 이 스스로 대는 id 는 믿지 않는다 */
function loadedWebviewId(f: HTMLIFrameElement): string | null {
  try {
    const u = new URL(f.src);
    if (u.origin !== wvOrigin) { return null; }
    const m = /^\/wv\/([^/]+)\/$/.exec(u.pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
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
      const id = loadedWebviewId(from);
      if (!id) { return; }
      withKey(id, k => { try { src.postMessage({ stcfsdBridge: 1, type: 'key', key: k }, target); } catch { /* 닫힘 */ } });
    } else if (d.type === 'keydown' && d.key === 'F2' && from.id === 'designer') {
      onF2();
    } else if (d.type === 'keydown' && d.key === 'Escape' && from.id === 'designer' && on) {
      setEditing(false);
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
  document.getElementById('side-title')!.textContent = bidiSafe(w.title || w.viewType || '');
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
