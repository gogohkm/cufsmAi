/**
 * 그림의 맞춤 · 확대 · 이동 — `.dv[data-zoom="<키>"]` 안의 첫 `<svg>` 의 viewBox 만 바꾼다(그림을 다시 계산하지 않는다).
 * 휠 = 커서 자리를 중심으로 확대 · 축소, 끌기 = 이동, 두 번 누르기 · 「전체 맞춤」 = 처음 viewBox.
 * 키마다 마지막 viewBox 를 기억해 다시 그려도(AI 가 바꿔도) 보는 자리가 그대로다 — 그림의 크기가 바뀌면 처음으로.
 */
interface Box { x: number; y: number; w: number; h: number }
const saved = new Map<string, { base: string; box: Box }>();

function parse(vb: string): Box { const [x, y, w, h] = vb.split(/\s+/).map(Number); return { x, y, w, h }; }
const fmt = (b: Box) => `${b.x} ${b.y} ${b.w} ${b.h}`;

/** 다시 그린 뒤 — 기억한 viewBox 를 되살린다 */
export function restoreZoom(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.dv[data-zoom]').forEach(dv => {
    const svg = dv.querySelector('svg');
    const key = dv.dataset.zoom!;
    if (!svg) { return; }
    const base = svg.getAttribute('viewBox') ?? '';
    const s = saved.get(key);
    if (s && s.base === base) { svg.setAttribute('viewBox', fmt(s.box)); }
    else { saved.delete(key); }
  });
}

export function fitZoom(key: string, root: ParentNode = document): void {
  saved.delete(key);
  const dv = root.querySelector<HTMLElement>(`.dv[data-zoom="${CSS.escape(key)}"]`);
  const svg = dv?.querySelector('svg');
  const base = svg?.dataset.base;
  if (svg && base) { svg.setAttribute('viewBox', base); }
}

function boxOf(svg: SVGSVGElement): Box { return parse(svg.getAttribute('viewBox') ?? '0 0 100 100'); }

/** 화면 좌표 → svg 좌표 */
function toSvg(svg: SVGSVGElement, cx: number, cy: number): { x: number; y: number } {
  const m = svg.getScreenCTM();
  if (!m) { return { x: cx, y: cy }; }
  const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function remember(dv: HTMLElement, svg: SVGSVGElement, b: Box): void {
  svg.setAttribute('viewBox', fmt(b));
  saved.set(dv.dataset.zoom!, { base: svg.dataset.base ?? '', box: b });
}

/** 한 번만 — 가운데 칸에 위임으로 단다 */
export function installZoom(host: HTMLElement): void {
  host.addEventListener('wheel', e => {
    const dv = (e.target as HTMLElement).closest<HTMLElement>('.dv[data-zoom]');
    const svg = dv?.querySelector('svg');
    if (!dv || !svg) { return; }
    e.preventDefault();
    const b = boxOf(svg);
    const p = toSvg(svg, e.clientX, e.clientY);
    const k = Math.exp(Math.sign(e.deltaY) * 0.12);
    const base = parse(svg.dataset.base ?? fmt(b));
    const w = Math.min(base.w * 4, Math.max(base.w / 40, b.w * k));
    const kk = w / b.w;
    remember(dv, svg, { x: p.x - (p.x - b.x) * kk, y: p.y - (p.y - b.y) * kk, w, h: b.h * kk });
  }, { passive: false });
  let drag: { dv: HTMLElement; svg: SVGSVGElement; x: number; y: number; b: Box; moved: boolean } | null = null;
  host.addEventListener('pointerdown', e => {
    if (e.button !== 0) { return; }
    const t = e.target as HTMLElement;
    if (t.closest('.hud, [data-pick], button, a, .chip')) { return; }
    const dv = t.closest<HTMLElement>('.dv[data-zoom]');
    const svg = dv?.querySelector('svg');
    if (!dv || !svg) { return; }
    drag = { dv, svg, x: e.clientX, y: e.clientY, b: boxOf(svg), moved: false };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) { return; }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) { return; }
    drag.moved = true;
    const r = drag.svg.getBoundingClientRect();
    const s = Math.max(drag.b.w / r.width, drag.b.h / r.height);
    remember(drag.dv, drag.svg, { ...drag.b, x: drag.b.x - dx * s, y: drag.b.y - dy * s });
  });
  window.addEventListener('pointerup', () => { drag = null; });
  host.addEventListener('dblclick', e => {
    const dv = (e.target as HTMLElement).closest<HTMLElement>('.dv[data-zoom]');
    if (dv && !(e.target as HTMLElement).closest('.hud')) { fitZoom(dv.dataset.zoom!, host); }
  });
}
