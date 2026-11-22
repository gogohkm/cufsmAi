/**
 * 단면 그림 — 절점 · 요소(MCP get_nodes · get_elements)에서 축척대로 그리는 순수 함수(데이터 → SVG 글).
 * 계산하지 않는다: 좌표를 mm 로 바꿔(units.ts) 놓을 뿐이다. 도심 표시는 MCP 단면 성질의 xcg · zcg, 중심선 폭 · 높이 치수는
 * MCP get_full_state 의 section.width · height 를 그대로 적는다.
 *
 * 시험이 읽는 표지: `<g class="sec-geo" data-nodes data-elems data-bbox="xmin,zmin,xmax,zmax">`(mm, 절점에서),
 * 절점 `<circle data-n data-x data-z>`(mm) · 요소 `<line data-e data-i data-j>`.
 */
import { esc } from './dom';
import { sigText } from './format';
import { si } from './units';

export interface SectionDrawOpt {
  w: number; h: number;
  nodes: number[][]; elems: number[][];
  /** 도심(US in) — MCP 단면 성질의 xcg · zcg */
  cg?: { x: number; z: number } | null;
  /** 중심선 폭 · 높이(US in) — MCP get_full_state 의 section */
  extent?: { width: number; height: number } | null;
  labels?: boolean; elemLabels?: boolean; dims?: boolean; axes?: boolean;
  hiNode?: number | null; hiElem?: number | null;
  mini?: boolean;
}

const f1 = (v: number) => v.toFixed(1);

function numT(v: number | null, src: string, kind: 'length'): string {
  if (v === null) { return '—'; }
  return `<tspan class="num" data-v="${v}" data-src="${esc(src)}" data-u="${kind}" data-x="0">${esc(sigText(v, 4))}</tspan>`;
}

export function sectionSvg(o: SectionDrawOpt): string {
  const W = o.w, H = o.h;
  const pts = new Map<number, { x: number; z: number }>();
  for (const n of o.nodes) {
    const x = si(n[1], 'length'), z = si(n[2], 'length');
    if (x !== null && z !== null) { pts.set(Number(n[0]), { x, z }); }
  }
  if (pts.size === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="단면 보기"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-faint)" font-size="13">절점 없음</text></svg>`;
  }
  const xs = [...pts.values()].map(p => p.x), zs = [...pts.values()].map(p => p.z);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const bw = Math.max(xmax - xmin, 1e-6), bh = Math.max(zmax - zmin, 1e-6);
  // 여백: 위는 보기 칩 줄(HUD)과 폭 치수, 왼쪽은 높이 치수, 아래는 축척 글
  const mTop = o.mini ? 8 : 96, mBot = o.mini ? 8 : 56, mSide = o.mini ? 8 : 80;
  const s = Math.min((W - 2 * mSide) / bw, (H - mTop - mBot) / bh);
  const cx = W / 2, cy = mTop + (H - mTop - mBot) / 2, xc = (xmin + xmax) / 2, zc = (zmin + zmax) / 2;
  const X = (x: number) => cx + s * (x - xc);
  const Y = (z: number) => cy - s * (z - zc);
  const g: string[] = [];

  // 도심 · 축(MCP 단면 성질의 도심)
  const cgx = o.cg ? si(o.cg.x, 'length') : null, cgz = o.cg ? si(o.cg.z, 'length') : null;
  if (o.axes && cgx !== null && cgz !== null) {
    g.push(`<line x1="${f1(X(xmin) - 40)}" y1="${f1(Y(cgz))}" x2="${f1(X(xmax) + 40)}" y2="${f1(Y(cgz))}" stroke="var(--line)" stroke-dasharray="5 4"/>`);
    g.push(`<line x1="${f1(X(cgx))}" y1="${f1(Y(zmax) - 40)}" x2="${f1(X(cgx))}" y2="${f1(Y(zmin) + 40)}" stroke="var(--line)" stroke-dasharray="5 4"/>`);
    g.push(`<text x="${f1(X(xmax) + 44)}" y="${f1(Y(cgz) + 4)}" font-size="11" fill="var(--text-faint)">x</text>`);
    g.push(`<text x="${f1(X(cgx) + 5)}" y="${f1(Y(zmax) - 44)}" font-size="11" fill="var(--text-faint)">z</text>`);
  }

  // 요소 — 두께를 축척대로
  const lines: string[] = [];
  for (const e of o.elems) {
    const a = pts.get(Number(e[1])), b = pts.get(Number(e[2]));
    if (!a || !b) { continue; }
    const t = si(e[3], 'length') ?? 0;
    const hi = o.hiElem === Number(e[0]);
    lines.push(`<line data-e="${Number(e[0])}" data-i="${Number(e[1])}" data-j="${Number(e[2])}" x1="${f1(X(a.x))}" y1="${f1(Y(a.z))}" x2="${f1(X(b.x))}" y2="${f1(Y(b.z))}" `
      + `stroke="${hi ? 'var(--accent)' : 'var(--steel)'}" stroke-width="${Math.max(o.mini ? 1.6 : 1.8, s * t).toFixed(2)}" stroke-linecap="round"/>`);
  }
  g.push(`<g class="sec-elems">${lines.join('')}</g>`);

  if (!o.mini) {
    // 요소 번호(기울임) — 법선 쪽으로 조금 떨어뜨린다
    if (o.elemLabels) {
      for (const e of o.elems) {
        const a = pts.get(Number(e[1])), b = pts.get(Number(e[2]));
        if (!a || !b) { continue; }
        const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
        const nx = -tz / L, nz = tx / L;
        g.push(`<text x="${f1(X((a.x + b.x) / 2) - nx * 13)}" y="${f1(Y((a.z + b.z) / 2) + nz * 13 + 3.5)}" font-size="9.5" text-anchor="middle" fill="var(--text-faint)" font-style="italic">${Number(e[0])}</text>`);
      }
    }
    // 절점
    const ids = [...pts.keys()];
    const step = ids.length > 80 ? Math.ceil(ids.length / 40) : 1;
    const circles: string[] = [];
    ids.forEach((id, k) => {
      const p = pts.get(id)!;
      const hi = o.hiNode === id;
      circles.push(`<circle data-n="${id}" data-x="${p.x}" data-z="${p.z}" cx="${f1(X(p.x))}" cy="${f1(Y(p.z))}" r="${hi ? 4.5 : 2.6}" `
        + `fill="${hi ? 'var(--accent)' : 'var(--bg-view)'}" stroke="${hi ? 'var(--accent)' : 'var(--text)'}" stroke-width="1.3"/>`);
      if (o.labels && (k % step === 0 || hi)) {
        const prev = pts.get(ids[Math.max(0, k - 1)])!, next = pts.get(ids[Math.min(ids.length - 1, k + 1)])!;
        const tx = next.x - prev.x, tz = next.z - prev.z, L = Math.hypot(tx, tz) || 1;
        const nx = -tz / L, nz = tx / L;
        circles.push(`<text x="${f1(X(p.x) + nx * 15)}" y="${f1(Y(p.z) - nz * 15 + 4)}" font-size="10.5" text-anchor="middle" fill="${hi ? 'var(--accent)' : 'var(--text-dim)'}" font-family="var(--mono)">${id}</text>`);
      }
    });
    g.push(`<g class="sec-nodes">${circles.join('')}</g>`);

    // 중심선 폭 · 높이(MCP get_full_state 의 section) — 그림의 경계에 치수선
    if (o.dims && o.extent) {
      const wmm = si(o.extent.width, 'length'), hmm = si(o.extent.height, 'length');
      const col = 'var(--dimc)';
      const yT = Y(zmax) - 34, xL = X(xmin) - 46;
      g.push(`<line x1="${f1(X(xmin))}" y1="${f1(Y(zmax) - 6)}" x2="${f1(X(xmin))}" y2="${f1(yT - 6)}" stroke="${col}" stroke-width=".8"/>`);
      g.push(`<line x1="${f1(X(xmax))}" y1="${f1(Y(zmax) - 6)}" x2="${f1(X(xmax))}" y2="${f1(yT - 6)}" stroke="${col}" stroke-width=".8"/>`);
      g.push(`<line x1="${f1(X(xmin))}" y1="${f1(yT)}" x2="${f1(X(xmax))}" y2="${f1(yT)}" stroke="${col}" marker-start="url(#arw)" marker-end="url(#arw)"/>`);
      g.push(`<text x="${f1((X(xmin) + X(xmax)) / 2)}" y="${f1(yT - 7)}" text-anchor="middle" font-size="12" fill="${col}" font-family="var(--mono)">폭 ${numT(wmm, 'full:section.width', 'length')}</text>`);
      g.push(`<line x1="${f1(X(xmin) - 6)}" y1="${f1(Y(zmax))}" x2="${f1(xL - 6)}" y2="${f1(Y(zmax))}" stroke="${col}" stroke-width=".8"/>`);
      g.push(`<line x1="${f1(X(xmin) - 6)}" y1="${f1(Y(zmin))}" x2="${f1(xL - 6)}" y2="${f1(Y(zmin))}" stroke="${col}" stroke-width=".8"/>`);
      g.push(`<line x1="${f1(xL)}" y1="${f1(Y(zmax))}" x2="${f1(xL)}" y2="${f1(Y(zmin))}" stroke="${col}" marker-start="url(#arw)" marker-end="url(#arw)"/>`);
      const my = (Y(zmax) + Y(zmin)) / 2;
      g.push(`<text x="${f1(xL - 9)}" y="${f1(my)}" text-anchor="middle" font-size="12" fill="${col}" font-family="var(--mono)" transform="rotate(-90 ${f1(xL - 9)} ${f1(my)})">높이 ${numT(hmm, 'full:section.height', 'length')}</text>`);
    }
    if (o.axes && cgx !== null && cgz !== null) {
      const px = X(cgx), py = Y(cgz);
      g.push(`<circle cx="${f1(px)}" cy="${f1(py)}" r="4" fill="none" stroke="var(--axis)"/><line x1="${f1(px - 7)}" y1="${f1(py)}" x2="${f1(px + 7)}" y2="${f1(py)}" stroke="var(--axis)"/><line x1="${f1(px)}" y1="${f1(py - 7)}" x2="${f1(px)}" y2="${f1(py + 7)}" stroke="var(--axis)"/>`);
    }
  }
  const defs = '<defs><marker id="arw" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="var(--dimc)"/></marker></defs>';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="단면 보기">${o.mini ? '' : defs}`
    + `<g class="sec-geo" data-nodes="${pts.size}" data-elems="${lines.length}" data-bbox="${xmin},${zmin},${xmax},${zmax}" data-scale="${s}">${g.join('')}</g></svg>`;
}
