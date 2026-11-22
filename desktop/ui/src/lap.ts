/**
 * 접합 도면 — 랩 접합(`lapConnectionResult`) · 단일 접합(`connectionResult`)을 그리는 순수 함수. 값은 엔진 결과(SI 로 바꾼 것)다.
 *
 * 랩(템플릿 06): 측면도(두 부재의 겹침 · 지점 · 랩 길이 · 패스너 · 짝힘), Cut A-A(「개략」 — 지금 단면을 두 겹으로), 패스너 배치(한쪽 랩 끝).
 *  - 엔진 값: 랩 길이 lap_left_in · lap_right_in, 부재 높이 d, 두께 t, 열 수 n_rows, 열당 n_per_row, 간격 spacing, 단부 거리 edge_distance,
 *    패스너 지름 fastener_dia · 이름 fastener_label, 전달 전단 V_transfer, 판정비 utilization · flexure_dcr, 판정 pass.
 *  - 그림의 규칙(지금 웹뷰의 랩 도면과 같은 배치 — `webview/js/app.js` _drawLapSvg): 열당 패스너를 양쪽 랩 끝에 반씩
 *    (왼쪽이 하나 더), 랩 끝에서 e, 다음은 + s. 열의 높이는 웨브 높이를 열 수로 나눈 자리 — **엔진은 열의 높이를 정하지 않는다(개략)**.
 *  - 짝힘 화살표는 자체 가정(force_model, §A1.2(c))의 V_transfer 를 랩 끝 패스너에 그린다.
 * 단일 접합: 두 판(t1 · t2)과 패스너 n 개를 한 줄로 — 엔진은 배치를 정하지 않으므로 「개략」.
 *
 * 시험이 읽는 표지: 패스너 `<circle class="fs" data-x(지점에서 mm) data-row>`, 랩 `<g class="lap" data-l data-r data-d data-n>`.
 */
import { esc } from './dom';
import { tnum } from './format';
import { si } from './units';

const f1 = (v: number) => v.toFixed(1);
const N = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function arrowDim(x1: number, y1: number, x2: number, y2: number, label: string, col = 'var(--dimc)', above = true): string {
  const vertical = Math.abs(x1 - x2) < 0.5;
  const tx = vertical ? x1 - 10 : (x1 + x2) / 2, ty = vertical ? (y1 + y2) / 2 : y1 + (above ? -7 : 15);
  return `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${col}" marker-start="url(#arw2)" marker-end="url(#arw2)"/>`
    + `<text x="${f1(tx)}" y="${f1(ty)}" font-size="11.5" fill="${col}" text-anchor="middle" font-family="var(--mono)"${vertical ? ` transform="rotate(-90 ${f1(tx)} ${f1(ty)})"` : ''}>${label}</text>`;
}

const DEFS = '<defs><marker id="arw2" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="var(--dimc)"/></marker></defs>';

export interface LapOpt { w: number; h: number; lap: { us: any; si: any }; nodes: number[][]; elems: number[][]; dims: boolean; force: boolean }

/** 패스너 x(지점 중심에서, mm)와 열 색인 — 머리말의 배치 규칙 */
export function lapFasteners(s: any): Array<{ x: number; row: number }> {
  const lapL = N(s.lap_left_in), lapR = N(s.lap_right_in), e = N(s.edge_distance), sp = N(s.spacing);
  const nRows = N(s.n_rows), nPer = N(s.n_per_row);
  if (lapL === null || lapR === null || e === null || nRows === null || nPer === null) { return []; }
  const nLeft = Math.ceil(nPer / 2), nRight = nPer - nLeft;
  const xs: number[] = [];
  for (let i = 0; i < nLeft; i++) { xs.push(-lapL + e + i * (sp ?? 0)); }
  for (let i = 0; i < nRight; i++) { xs.push(lapR - e - i * (sp ?? 0)); }
  const out: Array<{ x: number; row: number }> = [];
  for (const x of xs) { for (let r = 0; r < nRows; r++) { out.push({ x, row: r }); } }
  return out;
}

function rowFrac(nRows: number, r: number): number {
  if (nRows === 1) { return 0.5; }
  if (nRows === 2) { return r === 0 ? 0.25 : 0.75; }
  return (r + 0.5) / nRows;
}

export function lapSvg(o: LapOpt): string {
  const W = Math.round(o.w), H = Math.round(o.h);
  const s = o.lap.si;
  const lapL = N(s.lap_left_in), lapR = N(s.lap_right_in), d = N(s.d), t = N(s.t) ?? 2;
  if (lapL === null || lapR === null || d === null) {
    return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-faint)" font-size="13">랩 치수 없음(엔진 결과에 lap_left_in · lap_right_in · d 가 없다)</text></svg>`;
  }
  const g: string[] = [DEFS];
  const fsAll = lapFasteners(s);
  const nRows = N(s.n_rows) ?? 1;
  const dia = N(s.fastener_dia) ?? 10;
  const pass = s.pass;
  const fcol = pass === false ? 'var(--ng)' : 'var(--accent)';
  // ── 측면도 ──
  const ext = Math.max(0.5 * d, 0.25 * (lapL + lapR));
  const total = lapL + lapR + 2 * ext;
  const ex0 = 70, ex1 = W - 70;
  const sc = Math.min((ex1 - ex0) / total, (H * 0.30) / d);
  const supX = ex0 + (ext + lapL) * sc + ((ex1 - ex0) - total * sc) / 2;
  const topY = 110;
  const XS = (x: number) => supX + x * sc;
  const pxD = d * sc, gap = Math.max(2, t * sc);
  g.push(`<text x="24" y="40" font-size="12.5" font-weight="600" fill="var(--text)">측면도</text><text x="80" y="40" font-size="11" fill="var(--text-faint)">축척 1:${(1 / sc).toFixed(1)} · mm</text>`);
  // 부재 1(왼쪽 → 랩 오른쪽 끝) · 부재 2(랩 왼쪽 끝 → 오른쪽)
  const m1a = XS(-lapL - ext), m1b = XS(lapR), m2a = XS(-lapL), m2b = XS(lapR + ext);
  g.push(`<rect x="${f1(m1a)}" y="${topY}" width="${f1(m1b - m1a)}" height="${f1(pxD)}" fill="var(--steel)" fill-opacity=".08" stroke="var(--steel)" stroke-width="1.4"/>`);
  g.push(`<rect x="${f1(m2a)}" y="${f1(topY + gap)}" width="${f1(m2b - m2a)}" height="${f1(pxD)}" fill="var(--steel)" fill-opacity=".06" stroke="var(--steel2)" stroke-width="1.4" stroke-dasharray="6 3"/>`);
  g.push(`<rect x="${f1(XS(-lapL))}" y="${topY}" width="${f1((lapL + lapR) * sc)}" height="${f1(pxD + gap)}" fill="var(--accent)" opacity=".06"/>`);
  for (const x of [-lapL, lapR]) { g.push(`<line x1="${f1(XS(x))}" y1="${topY - 14}" x2="${f1(XS(x))}" y2="${f1(topY + pxD + gap + 14)}" stroke="var(--lapc)" stroke-dasharray="3 4"/>`); }
  // 지점
  const sy = topY + pxD + gap + 6;
  g.push(`<path d="M${f1(supX)} ${f1(sy)} l-9 14 h18 z" fill="none" stroke="var(--warn)" stroke-width="1.5"/><text x="${f1(supX + 14)}" y="${f1(sy + 26)}" font-size="11.5" fill="var(--text-dim)">지점</text>`);
  // 패스너
  const r = Math.max(4, (dia / 2) * sc);
  const fcirc = fsAll.map(f => {
    const cy = topY + gap / 2 + pxD * rowFrac(nRows, f.row);
    return `<circle class="fs" data-x="${f.x}" data-row="${f.row}" cx="${f1(XS(f.x))}" cy="${f1(cy)}" r="${f1(r)}" fill="var(--bg-view)" stroke="${fcol}" stroke-width="1.6"/>`
      + `<line x1="${f1(XS(f.x) - r * 0.6)}" y1="${f1(cy)}" x2="${f1(XS(f.x) + r * 0.6)}" y2="${f1(cy)}" stroke="${fcol}" stroke-width="1"/>`;
  }).join('');
  g.push(fcirc);
  // 짝힘(자체 가정) — 랩 끝의 패스너에
  if (o.force && N(s.V_transfer) !== null && fsAll.length) {
    const left = fsAll.filter(f => f.x < 0), right = fsAll.filter(f => f.x > 0);
    const yy = topY + gap / 2 + pxD * rowFrac(nRows, 0);
    if (left.length) { g.push(`<line x1="${f1(XS(left[0].x) + r + 2)}" y1="${f1(yy)}" x2="${f1(XS(left[0].x) + r + 30)}" y2="${f1(yy)}" stroke="var(--warn)" stroke-width="1.8" marker-end="url(#arw2)"/>`); }
    if (right.length) { g.push(`<line x1="${f1(XS(right[0].x) - r - 2)}" y1="${f1(yy)}" x2="${f1(XS(right[0].x) - r - 30)}" y2="${f1(yy)}" stroke="var(--warn)" stroke-width="1.8" marker-end="url(#arw2)"/>`); }
    g.push(`<text x="${f1(XS(lapR) + 10)}" y="${f1(topY + 14)}" font-size="11.5" fill="var(--warn)" font-family="var(--mono)">V ${tnum(s.V_transfer, { src: 'lap:V_transfer', kind: 'force', sig: 3 })} kN</text>`
      + `<rect x="${f1(XS(lapR) + 8)}" y="${f1(topY + 20)}" width="62" height="18" rx="3" fill="none" stroke="var(--warn)"/><text x="${f1(XS(lapR) + 39)}" y="${f1(topY + 33)}" font-size="11" text-anchor="middle" fill="var(--warn)">자체 가정</text>`);
  }
  if (o.dims) {
    const dy = topY - 34;
    g.push(arrowDim(XS(-lapL), dy, XS(0), dy, tnum(lapL, { src: 'lap:lap_left_in', kind: 'length', sig: 4 })));
    g.push(arrowDim(XS(0), dy, XS(lapR), dy, tnum(lapR, { src: 'lap:lap_right_in', kind: 'length', sig: 4 })));
    g.push(arrowDim(XS(lapR + ext) + 24, topY, XS(lapR + ext) + 24, topY + pxD, `d ${tnum(d, { src: 'lap:d', kind: 'length', sig: 4 })}`));
    g.push(`<text x="${f1(XS(-lapL))}" y="${f1(sy + 30)}" font-size="11.5" fill="var(--accent)">${esc(String(o.lap.us.fastener_label ?? '패스너'))} × ${tnum(N(s.n_total), { src: 'lap:n_total', kind: 'none' })}`
      + ` · ${tnum(N(s.n_rows), { src: 'lap:n_rows', kind: 'none' })}열 × ${tnum(N(s.n_per_row), { src: 'lap:n_per_row', kind: 'none' })}</text>`);
  }
  // 자르는 자리 A-A — 오른쪽 랩 끝 패스너 열(그림의 자리)
  const rightFs = fsAll.filter(f => f.x > 0);
  if (rightFs.length) {
    const xa = XS(Math.min(...rightFs.map(f => f.x))) - r - 14;
    g.push(`<line x1="${f1(xa)}" y1="${topY - 10}" x2="${f1(xa)}" y2="${f1(topY + pxD + gap + 10)}" stroke="var(--text-dim)" stroke-dasharray="10 3 2 3"/>`
      + `<text x="${f1(xa + 6)}" y="${topY - 12}" font-size="11.5" font-weight="600" fill="var(--text)">A</text><text x="${f1(xa + 6)}" y="${f1(topY + pxD + gap + 22)}" font-size="11.5" font-weight="600" fill="var(--text)">A</text>`);
  }
  g.push(`<g class="lap" data-l="${lapL}" data-r="${lapR}" data-d="${d}" data-n="${fsAll.length}"></g>`);

  // ── Cut A-A(개략) ──
  const cy0 = 330, cyH = H - cy0 - 40;
  g.push(`<text x="24" y="${cy0 - 8}" font-size="12.5" font-weight="600" fill="var(--text)">Cut A-A</text><text x="96" y="${cy0 - 8}" font-size="11" fill="var(--text-faint)" data-tip="플랜지 폭이 같은 Z 는 실제로는 그대로 겹쳐지지 않는다 — 구성안 9장 6c">겹침 — 개략</text>`);
  const pts = o.nodes.map(n => ({ id: Number(n[0]), x: si(n[1], 'length')!, z: si(n[2], 'length')! })).filter(p => Number.isFinite(p.x));
  if (pts.length) {
    const bx0 = Math.min(...pts.map(p => p.x)), bx1 = Math.max(...pts.map(p => p.x)), bz0 = Math.min(...pts.map(p => p.z)), bz1 = Math.max(...pts.map(p => p.z));
    const k = Math.min((W * 0.42) / Math.max(1, bx1 - bx0 + 3 * t), cyH / Math.max(1, bz1 - bz0 + 3 * t));
    const ox = 60 + (W * 0.45 - (bx1 - bx0) * k) / 2, oz = cy0 + 20;
    const PX = (x: number, dx = 0) => ox + (x - bx0 + dx) * k, PZ = (z: number, dz = 0) => oz + (bz1 - z + dz) * k;
    const byId = new Map(pts.map(p => [p.id, p]));
    const draw = (dx: number, dz: number, col: string) => o.elems.map(e => {
      const a = byId.get(Number(e[1])), b = byId.get(Number(e[2]));
      return a && b ? `<line x1="${f1(PX(a.x, dx))}" y1="${f1(PZ(a.z, dz))}" x2="${f1(PX(b.x, dx))}" y2="${f1(PZ(b.z, dz))}" stroke="${col}" stroke-width="${Math.max(1.6, t * k).toFixed(1)}" stroke-linecap="round"/>` : '';
    }).join('');
    g.push(draw(0, 0, 'var(--steel)'), draw(t, t, 'var(--steel2)'));
    // 웨브 = 세로로 가장 길게 이어진 절점 열(그림의 자리를 찾는 것 — 값이 아니다)
    const cols = new Map<number, number[]>();
    for (const q of pts) { const key = Math.round(q.x * 10) / 10; cols.set(key, [...(cols.get(key) ?? []), q.z]); }
    let wx = bx0, best = -1;
    // 절점이 가장 많은 열(립 C 는 위 · 아래 립이 같은 x 라 세로 범위만으로는 웨브와 비긴다) — 같으면 세로 범위가 긴 쪽
    for (const [x, zz] of cols) { const r = zz.length * 1e6 + (Math.max(...zz) - Math.min(...zz)); if (r > best) { best = r; wx = x; } }
    const webX = PX(wx);
    for (let rr = 0; rr < nRows; rr++) {
      const zz = oz + (bz1 - bz0) * k * rowFrac(nRows, rr);
      g.push(`<rect x="${f1(webX - 16)}" y="${f1(zz - 3)}" width="${f1(32 + t * k)}" height="6" fill="${fcol}" opacity=".8"/>`);
    }
    g.push(`<text x="${f1(PX(bx0))}" y="${f1(PZ(bz0) + 26)}" font-size="11" fill="var(--text-dim)">바깥 · 안쪽 부재(지금 단면)</text>`);
  } else {
    g.push(`<text x="60" y="${cy0 + 40}" font-size="12" fill="var(--text-faint)">단면 없음</text>`);
  }

  // ── 패스너 배치(왼쪽 랩) ──
  const px0 = W * 0.56, pw = W * 0.38, pz0 = cy0 + 20, ph = Math.min(cyH - 30, pw * d / Math.max(1, lapL));
  const pk = Math.min(pw / lapL, ph / d);
  g.push(`<text x="${f1(px0)}" y="${cy0 - 8}" font-size="12.5" font-weight="600" fill="var(--text)">패스너 배치</text><text x="${f1(px0 + 80)}" y="${cy0 - 8}" font-size="11" fill="var(--text-faint)">왼쪽 랩 끝 · 웨브</text>`);
  g.push(`<rect x="${f1(px0)}" y="${f1(pz0)}" width="${f1(lapL * pk)}" height="${f1(d * pk)}" fill="none" stroke="var(--steel)" stroke-width="1.2"/>`);
  const leftFs = fsAll.filter(f => f.x < 0);
  for (const f of leftFs) {
    const fx = px0 + (f.x + lapL) * pk, fz = pz0 + d * pk * rowFrac(nRows, f.row);
    g.push(`<circle cx="${f1(fx)}" cy="${f1(fz)}" r="${f1(Math.max(5, dia / 2 * pk))}" fill="none" stroke="${fcol}" stroke-width="1.6"/>`);
  }
  if (o.dims && leftFs.length) {
    g.push(arrowDim(px0, pz0 + d * pk + 18, px0 + N(s.edge_distance)! * pk, pz0 + d * pk + 18, `e ${tnum(N(s.edge_distance), { src: 'lap:edge_distance', kind: 'length', sig: 3 })}`, 'var(--dimc)', false));
    if (leftFs.some(f => f.x > leftFs[0].x)) { g.push(arrowDim(px0 + N(s.edge_distance)! * pk, pz0 + d * pk + 40, px0 + (N(s.edge_distance)! + (N(s.spacing) ?? 0)) * pk, pz0 + d * pk + 40, `s ${tnum(N(s.spacing), { src: 'lap:spacing', kind: 'length', sig: 4 })}`, 'var(--dimc)', false)); }
 g.push(`<text x="${f1(px0)}" y="${f1(pz0 + d * pk + 82)}" font-size="11" fill="var(--text-faint)" font-family="var(--mono)">지름 ${tnum(dia, { src: 'lap:fastener_dia', kind: 'length', sig: 3 })} · 열 높이는 개략(엔진은 정하지 않는다)</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="접합 도면">${g.join('')}</svg>`;
}

/** 단일 접합(개략) — 두 판과 패스너 n 개 */
export function connSvg(w: number, h: number, c: { us: any; si: any }): string {
  const W = Math.round(w), H = Math.round(h);
  const req = c.us.request ?? c.us;
  const t1 = si(req.t1, 'length'), t2 = si(req.t2, 'length'), d = si(req.d, 'length');
  const n = N(req.n) ?? N(c.us.n) ?? 1;
  const g: string[] = [DEFS];
  g.push(`<text x="24" y="40" font-size="12.5" font-weight="600" fill="var(--text)">단일 접합</text><text x="104" y="40" font-size="11" fill="var(--text-faint)">${esc(String(req.connection_type ?? ''))} · 개략(엔진은 배치를 정하지 않는다)</text>`);
  const x0 = 120, x1 = W - 120, y = H * 0.42;
  const sc = 6;
  const T1 = Math.max(3, (t1 ?? 1) * sc), T2 = Math.max(3, (t2 ?? 1) * sc);
  g.push(`<rect x="${x0}" y="${f1(y - T1)}" width="${f1((x1 - x0) * 0.62)}" height="${f1(T1)}" fill="var(--steel)" fill-opacity=".15" stroke="var(--steel)"/>`);
  g.push(`<rect x="${f1(x0 + (x1 - x0) * 0.38)}" y="${f1(y)}" width="${f1((x1 - x0) * 0.62)}" height="${f1(T2)}" fill="var(--steel)" fill-opacity=".1" stroke="var(--steel2)"/>`);
  const a = x0 + (x1 - x0) * 0.38, b = x0 + (x1 - x0) * 0.62;
  for (let i = 0; i < n; i++) {
    const fx = a + (b - a) * (i + 0.5) / n;
    g.push(`<circle class="fs" data-x="${i}" data-row="0" cx="${f1(fx)}" cy="${f1(y)}" r="7" fill="var(--bg-view)" stroke="var(--accent)" stroke-width="1.6"/>`);
  }
  g.push(`<text x="${x0}" y="${f1(y - T1 - 10)}" font-size="11.5" fill="var(--dimc)" font-family="var(--mono)">t1 ${tnum(t1, { src: 'connreq:t1', kind: 'length', sig: 3 })}</text>`);
  g.push(`<text x="${f1(x1 - 120)}" y="${f1(y + T2 + 20)}" font-size="11.5" fill="var(--dimc)" font-family="var(--mono)">t2 ${tnum(t2, { src: 'connreq:t2', kind: 'length', sig: 3 })}</text>`);
  g.push(`<text x="${f1(a)}" y="${f1(y + T2 + 46)}" font-size="11.5" fill="var(--accent)" font-family="var(--mono)">d ${tnum(d, { src: 'connreq:d', kind: 'length', sig: 3 })} × ${tnum(n, { src: 'connreq:n', kind: 'none' })}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="접합 도면">${g.join('')}</svg>`;
}
