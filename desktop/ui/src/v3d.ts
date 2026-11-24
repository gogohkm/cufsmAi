/**
 * 3D 모드 형상 — 제품의 렌더러 번들(`media/viewer3d.js`, Babylon.js)을 다리가 이 화면의 출처에서 내주는 `/ui/viewer3d/…` 로 싣는다
 * (host/BRIDGE.md 「3D 렌더러를 새 화면에서」 — CSP 를 넓히지 않는다). 자료는 2D 와 같다: 해석의 절점 · 요소(US) · 모드 벡터 · 반파장.
 *
 * 렌더러 하나는 캔버스 하나에 붙는다(CufsmViewer3D._modeInstance). 화면은 다시 그릴 때마다 HTML 을 갈아 끼우므로 캔버스는
 * 한 번만 만들고 그 자리(`[data-v3d]`)로 옮겨 붙인다 — WebGL 문맥이 그대로 남는다. 같은 (해석 · 반파장 · 모드)면 다시 그리지 않는다.
 * WebGL 이 없으면 render 가 던진다 — 그때는 그 자리에 까닭을 적고 2D 로 돌아갈 수 있게 둔다.
 */
import { state } from './store';

type Viewer = { render(d: unknown): Promise<void>; _modeInstance?: { _engine?: { resize(): void } } | null };
let loading: Promise<Viewer> | null = null;
let canvas: HTMLCanvasElement | null = null;
let drawnKey = '';
let lastError = '';

export const v3dError = (): string => lastError;

function load(): Promise<Viewer> {
  if (loading) { return loading; }
  loading = new Promise<Viewer>((ok, no) => {
    const w = window as unknown as { CufsmViewer3D?: Viewer };
    if (w.CufsmViewer3D) { ok(w.CufsmViewer3D); return; }
    const s = document.createElement('script');
    s.src = '/ui/viewer3d/viewer3d.js';
    s.onload = () => (w.CufsmViewer3D ? ok(w.CufsmViewer3D) : no(new Error('3D 렌더러가 실리지 않았다')));
    s.onerror = () => no(new Error('3D 렌더러 번들을 싣지 못했다(/ui/viewer3d/viewer3d.js)'));
    document.head.appendChild(s);
  });
  loading.catch(() => { loading = null; });
  return loading;
}

/** 다시 그린 뒤 — 자리가 있으면 캔버스를 붙이고(처음이면 싣고) 그 모양을 그린다 */
export function mount3d(root: HTMLElement, len: number, mode: number): void {
  const slot = root.querySelector('[data-v3d]') as HTMLElement | null;
  if (!slot) { return; }
  const an = state.analysis;
  const sh = an?.shapes?.[len];
  if (!an || !Array.isArray(sh)) { slot.innerHTML = '<div class="ph-box"><b>3D 모드 형상 없음</b><span>모드 형상이 없다</span></div>'; return; }
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'mode-shape-3d-canvas';
    canvas.className = 'v3d-canvas';
  }
  slot.appendChild(canvas);
  const r = slot.getBoundingClientRect();
  canvas.width = Math.max(200, Math.round(r.width));
  canvas.height = Math.max(160, Math.round(r.height));
  const key = `${an.seq}:${len}:${mode}:${canvas.width}x${canvas.height}`;
  if (key === drawnKey) {
    (window as unknown as { CufsmViewer3D?: Viewer }).CufsmViewer3D?._modeInstance?._engine?.resize();
    slot.setAttribute('data-state', 'drawn'); slot.setAttribute('data-len', String(len)); slot.setAttribute('data-mode', String(mode));
    return;
  }
  slot.setAttribute('data-state', 'loading');
  void load().then(async v => {
    const modeVec = sh.map(row => (Array.isArray(row) ? Number(row[mode - 1]) || 0 : Number(row) || 0));
    await v.render({ nodes: an.nodes, elems: an.elems, modeVec, length: an.curve[len][0], BC: state.full?.BC || 'S-S', scale: 0.3 });
    v._modeInstance?._engine?.resize();
    drawnKey = key;
    lastError = '';
    slot.setAttribute('data-state', 'drawn');
    slot.setAttribute('data-len', String(len));
    slot.setAttribute('data-mode', String(mode));
  }).catch((e: unknown) => {
    lastError = e instanceof Error ? e.message : String(e);
    slot.setAttribute('data-state', 'error');
    const msg = document.createElement('div');
    msg.className = 'ph-box';
    msg.innerHTML = '<b>3D 를 그리지 못했다</b>';
    const sp = document.createElement('span');
    sp.textContent = `${lastError} — 2D 를 쓴다(칩 「3D」 끄기)`;
    msg.appendChild(sp);
    slot.appendChild(msg);
  });
}
