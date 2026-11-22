/**
 * 단면 그림 — 절점 · 요소(MCP get_nodes · get_elements)에서 축척대로 그리는 순수 함수(데이터 → SVG 글). 계산하지 않는다.
 *
 * 무엇을 어디서:
 *  - 형상: 절점 좌표(in → mm, units.ts) · 요소 두께(선 굵기)
 *  - 도심 · 주축 1 · 2 · θp: MCP 단면 성질의 xcg · zcg · thetap(도, x 축에서 반시계). 전단 중심: MCP get_cutwp 의 Xs · Zs
 *  - 응력: 모델의 절점 응력(n[7], ksi → MPa) — 요소의 법선 쪽으로 그 크기만큼 띠(압축 + 빨강 · 인장 − 파랑)
 *  - 치수: 템플릿 단면이면 템플릿의 치수(H · B · D · t · r — get_full_state 의 section_params(K4a), 바깥-바깥). 템플릿이 아니면 중심선
 *    폭 · 높이(MCP get_full_state 의 section).
 *  - 모드 형상: 해석의 모드 벡터(u · w — 전역 x · z 변위)를 절점에 더한다. 배율은 임의(가장 큰 변위 = 단면 크기의 15 %).
 *
 * 치수선의 자리(그림의 기하 — 공학 판단이 아니다): 바깥면 = 중심선 좌표의 끝 ± t/2. 웨브 = 절점이 가장 많은 세로 열(같으면
 * 세로 범위가 긴 쪽 — 둥근 모서리의 호 절점은 열을 이루지 않는다). H 는 단면 전체 높이의 왼쪽(전단 중심이 단면 왼쪽 밖이면 그보다
 * 더 왼쪽), B 는 윗(앵글은 아랫) 플랜지 쪽 절반의 절점 가운데 웨브에서 먼 끝까지 — 웨브 바깥면부터, 립이 있으면 립 바깥면 · 없으면
 * 플랜지 끝 절점까지. D 는 그 끝 x 의 절점 열(립) 가운데 이 플랜지 쪽 절반에서 플랜지 바깥면부터 립 끝 절점까지, t 는 웨브의
 * 가운데, r 은 웨브와 그 플랜지의 모서리를 가리킨다.
 * 각형 · 원형 · I · T 는 전체 폭과 높이, 햇은 B 가 전체 높이 · H 가 윗면 폭이다.
 *
 * 시험이 읽는 표지: `<g class="sec-geo" data-nodes data-elems data-bbox="xmin,zmin,xmax,zmax">`(mm), 절점 `<circle data-n data-x data-z>`,
 * 요소 `<line data-e data-i data-j>`, 치수 `<g class="lead" data-k data-a data-b>`(mm, 양 끝), 주축 `<g class="paxes" data-theta>`,
 * 전단 중심 `<g class="sc" data-x data-z>`, 응력 `<polygon class="st" data-e data-si data-sj>`(MPa), 모드 `<circle class="md" data-n data-u data-w>`(엔진 값).
 */
import { esc } from './dom';
import { sigText } from './format';
import { si } from './units';

export interface ModeOverlay {
  /** 그 길이의 모드 벡터(자유도 차례 [u1 v1 … un vn | w1 θ1 … wn θn]) — 해석의 shapes[길이][·][모드] */
  vec: number[];
  /** 해석에 쓴 절점(차례가 모드 벡터와 같다) */
  nodes: number[][];
}

export interface SectionDrawOpt {
  w: number; h: number;
  nodes: number[][]; elems: number[][];
  /** 도심 · 주축(MCP 단면 성질, in · 도) */
  props?: { xcg: number; zcg: number; thetap?: number } | null;
  /** 전단 중심(MCP get_cutwp, in) */
  shear?: { Xs: number; Zs: number } | null;
  /** 중심선 폭 · 높이(US in) — 템플릿이 아닐 때의 치수 */
  extent?: { width: number; height: number } | null;
  /** 템플릿 이름과 치수(in) — get_full_state 의 section_template · section_params */
  template?: { name: string; params: Record<string, number> } | null;
  labels?: boolean; elemLabels?: boolean; dims?: boolean; axes?: boolean; stress?: boolean;
  hiNode?: number | null; hiElem?: number | null;
  mode?: ModeOverlay | null;
  mini?: boolean;
  /** 뒤집어 그리기 — 쓰지 않는다(엔진의 좌표 그대로) */
}

const f1 = (v: number) => v.toFixed(1);

function numT(v: number | null, src: string, kind: 'length' | 'none' | 'stress'): string {
  if (v === null) { return '—'; }
  return `<tspan class="num" data-v="${v}" data-src="${esc(src)}" data-u="${kind}" data-x="0">${esc(sigText(v, 4))}</tspan>`;
}

interface P { x: number; z: number }

export function sectionSvg(o: SectionDrawOpt): string {
  const W = Math.round(o.w), H = Math.round(o.h);
  const pts = new Map<number, P>();
  for (const n of o.nodes) {
    const x = si(n[1], 'length'), z = si(n[2], 'length');
    if (x !== null && z !== null) { pts.set(Number(n[0]), { x, z }); }
  }
  if (pts.size === 0) {
    return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" role="img" aria-label="단면 보기"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-faint)" font-size="13">절점 없음</text></svg>`;
  }
  const all = [...pts.values()];
  const xs = all.map(p => p.x), zs = all.map(p => p.z);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const bw = Math.max(xmax - xmin, 1e-6), bh = Math.max(zmax - zmin, 1e-6);
  const mTop = o.mini ? 8 : 96, mBot = o.mini ? 8 : 56, mSide = o.mini ? 8 : 96;
  const s = Math.min((W - 2 * mSide) / bw, (H - mTop - mBot) / bh);
  const cx = W / 2, cy = mTop + (H - mTop - mBot) / 2, xc = (xmin + xmax) / 2, zc = (zmin + zmax) / 2;
  const X = (x: number) => cx + s * (x - xc);
  const Y = (z: number) => cy - s * (z - zc);
  const g: string[] = [];
  const tElem = o.elems.length ? (si(o.elems[0][3], 'length') ?? 0) : 0;

  // 축(도심 · 주축) — 형상보다 뒤에
  const cgx = o.props ? si(o.props.xcg, 'length') : null, cgz = o.props ? si(o.props.zcg, 'length') : null;
  if (o.axes && !o.mini && cgx !== null && cgz !== null) {
    g.push(`<line x1="${f1(X(xmin) - 40)}" y1="${f1(Y(cgz))}" x2="${f1(X(xmax) + 40)}" y2="${f1(Y(cgz))}" stroke="var(--line)" stroke-dasharray="5 4"/>`);
    g.push(`<line x1="${f1(X(cgx))}" y1="${f1(Y(zmax) - 40)}" x2="${f1(X(cgx))}" y2="${f1(Y(zmin) + 40)}" stroke="var(--line)" stroke-dasharray="5 4"/>`);
    g.push(`<text x="${f1(X(xmax) + 44)}" y="${f1(Y(cgz) + 4)}" font-size="11" fill="var(--text-faint)">x</text>`);
    g.push(`<text x="${f1(X(cgx) + 5)}" y="${f1(Y(zmax) - 44)}" font-size="11" fill="var(--text-faint)">z</text>`);
    const th = Number(o.props?.thetap);
    if (Number.isFinite(th)) {
      const a = th * Math.PI / 180, R = 0.62 * Math.hypot(bw, bh) * s;
      const ux = Math.cos(a), uz = Math.sin(a);
      const px = X(cgx), py = Y(cgz);
      g.push(`<g class="paxes" data-theta="${th}">`
        + `<line x1="${f1(px - R * ux)}" y1="${f1(py + R * uz)}" x2="${f1(px + R * ux)}" y2="${f1(py - R * uz)}" stroke="var(--axis)" stroke-dasharray="9 3 2 3"/>`
        + `<line x1="${f1(px + 0.6 * R * uz)}" y1="${f1(py + 0.6 * R * ux)}" x2="${f1(px - 0.6 * R * uz)}" y2="${f1(py - 0.6 * R * ux)}" stroke="var(--axis)" stroke-dasharray="9 3 2 3"/>`
        + `<text x="${f1(px + R * ux + 6)}" y="${f1(py - R * uz + 4)}" font-size="11" fill="var(--axis)">1</text>`
        + `<text x="${f1(px - 0.6 * R * uz + 6)}" y="${f1(py - 0.6 * R * ux)}" font-size="11" fill="var(--axis)">2</text>`
        + `<text x="${f1(px + 14)}" y="${f1(py + 26)}" font-size="11" fill="var(--axis)" font-family="var(--mono)">θp ${numT(th, 'props:thetap', 'none')}°</text></g>`);
    }
  }

  // 응력 — 요소의 법선 쪽 띠(크기 ∝ |σ|, 가장 큰 |σ| = 단면 크기의 12 %)
  const stressById = new Map<number, number>();
  for (const n of o.nodes) { const v = si(n[7], 'stress'); if (v !== null) { stressById.set(Number(n[0]), v); } }
  const smax = Math.max(0, ...[...stressById.values()].map(Math.abs));
  if (o.stress && smax > 0) {
    const k = 0.12 * Math.max(bw, bh) / smax;
    const polys: string[] = [];
    for (const e of o.elems) {
      const a = pts.get(Number(e[1])), b = pts.get(Number(e[2]));
      if (!a || !b) { continue; }
      const sa = stressById.get(Number(e[1])) ?? 0, sb = stressById.get(Number(e[2])) ?? 0;
      const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1, nx = -tz / L, nz = tx / L;
      const col = sa + sb >= 0 ? 'var(--ng)' : 'var(--accent)';
      polys.push(`<polygon class="st" data-e="${Number(e[0])}" data-si="${sa}" data-sj="${sb}" points="${f1(X(a.x))},${f1(Y(a.z))} ${f1(X(b.x))},${f1(Y(b.z))} `
        + `${f1(X(b.x + nx * k * sb))},${f1(Y(b.z + nz * k * sb))} ${f1(X(a.x + nx * k * sa))},${f1(Y(a.z + nz * k * sa))}" fill="${col}" fill-opacity=".2" stroke="${col}" stroke-opacity=".55" stroke-width=".8"/>`);
    }
    g.push(`<g class="stress">${polys.join('')}</g>`);
  }

  // 요소 — 두께를 축척대로(모드가 있으면 회색 = 변형 전)
  const lines: string[] = [];
  for (const e of o.elems) {
    const a = pts.get(Number(e[1])), b = pts.get(Number(e[2]));
    if (!a || !b) { continue; }
    const t = si(e[3], 'length') ?? 0;
    const hi = o.hiElem === Number(e[0]);
    lines.push(`<line data-e="${Number(e[0])}" data-i="${Number(e[1])}" data-j="${Number(e[2])}" x1="${f1(X(a.x))}" y1="${f1(Y(a.z))}" x2="${f1(X(b.x))}" y2="${f1(Y(b.z))}" `
      + `stroke="${hi ? 'var(--accent)' : o.mode ? 'var(--ghost)' : 'var(--steel)'}" stroke-width="${Math.max(o.mini ? 1.6 : 1.8, s * t).toFixed(2)}" stroke-linecap="round"/>`);
  }
  g.push(`<g class="sec-elems">${lines.join('')}</g>`);

  // 모드 형상
  if (o.mode && o.mode.vec.length >= 4 * o.mode.nodes.length) {
    const n = o.mode.nodes.length;
    const u = (i: number) => Number(o.mode!.vec[2 * i]) || 0;
    const w = (i: number) => Number(o.mode!.vec[2 * n + 2 * i]) || 0;
    let dmax = 0;
    for (let i = 0; i < n; i++) { dmax = Math.max(dmax, Math.hypot(u(i), w(i))); }
    const k = dmax > 0 ? 0.15 * Math.max(bw, bh) / dmax : 0;
    const def = new Map<number, P>();
    o.mode.nodes.forEach((nd, i) => {
      const p = pts.get(Number(nd[0]));
      if (p) { def.set(Number(nd[0]), { x: p.x + k * u(i), z: p.z + k * w(i) }); }
    });
    const ml: string[] = [];
    for (const e of o.elems) {
      const a = def.get(Number(e[1])), b = def.get(Number(e[2]));
      if (a && b) { ml.push(`<line x1="${f1(X(a.x))}" y1="${f1(Y(a.z))}" x2="${f1(X(b.x))}" y2="${f1(Y(b.z))}" stroke="var(--modec)" stroke-width="${o.mini ? 1.6 : 2.4}" stroke-linecap="round"/>`); }
    }
    const mc = o.mini ? '' : o.mode.nodes.map((nd, i) => {
      const p = def.get(Number(nd[0]));
      return p ? `<circle class="md" data-n="${Number(nd[0])}" data-u="${u(i)}" data-w="${w(i)}" cx="${f1(X(p.x))}" cy="${f1(Y(p.z))}" r="2" fill="var(--modec)"/>` : '';
    }).join('');
    g.push(`<g class="mode" data-scale="${k}">${ml.join('')}${mc}</g>`);
  }

  if (!o.mini) {
    if (o.elemLabels) {
      for (const e of o.elems) {
        const a = pts.get(Number(e[1])), b = pts.get(Number(e[2]));
        if (!a || !b) { continue; }
        const tx = b.x - a.x, tz = b.z - a.z, L = Math.hypot(tx, tz) || 1;
        const nx = -tz / L, nz = tx / L;
        g.push(`<text x="${f1(X((a.x + b.x) / 2) - nx * 13)}" y="${f1(Y((a.z + b.z) / 2) + nz * 13 + 3.5)}" font-size="9.5" text-anchor="middle" fill="var(--text-faint)" font-style="italic">${Number(e[0])}</text>`);
      }
    }
    const ids = [...pts.keys()];
    const step = ids.length > 80 ? Math.ceil(ids.length / 40) : 1;
    const circles: string[] = [];
    ids.forEach((id, k) => {
      const p = pts.get(id)!;
      const hi = o.hiNode === id;
      const show = o.labels || hi;
      circles.push(`<circle data-n="${id}" data-x="${p.x}" data-z="${p.z}" cx="${f1(X(p.x))}" cy="${f1(Y(p.z))}" r="${hi ? 4.5 : show ? 2.6 : 0}" `
        + `fill="${hi ? 'var(--accent)' : 'var(--bg-view)'}" stroke="${hi ? 'var(--accent)' : 'var(--text)'}" stroke-width="${show ? 1.3 : 0}"/>`);
      if (o.labels && (k % step === 0 || hi)) {
        const prev = pts.get(ids[Math.max(0, k - 1)])!, next = pts.get(ids[Math.min(ids.length - 1, k + 1)])!;
        const tx = next.x - prev.x, tz = next.z - prev.z, L = Math.hypot(tx, tz) || 1;
        const nx = -tz / L, nz = tx / L;
        circles.push(`<text x="${f1(X(p.x) + nx * 15)}" y="${f1(Y(p.z) - nz * 15 + 4)}" font-size="10.5" text-anchor="middle" fill="${hi ? 'var(--accent)' : 'var(--text-dim)'}" font-family="var(--mono)">${id}</text>`);
      }
    });
    g.push(`<g class="sec-nodes">${circles.join('')}</g>`);

    if (o.dims) {
      const tpl = o.template;
      // 전단 중심이 단면 왼쪽 밖에 있으면 H 치수선을 그보다 더 왼쪽으로(표지 · 글이 겹치지 않게)
      const scx0 = o.axes && o.shear ? si(o.shear.Xs, 'length') : null;
      const padL = scx0 !== null && scx0 < xmin ? X(xmin) - X(scx0) + 24 : 0;
      if (tpl && Object.keys(tpl.params).length) { g.push(templateLeaders(tpl, all, tElem, { X, Y, s }, padL)); }
      else if (o.extent) { g.push(extentLeaders(o.extent, { xmin, xmax, zmin, zmax }, { X, Y })); }
    }
    if (o.stress && smax > 0) {
      // 띠와 같은 값 — 절점 응력(get_nodes 의 7 열)의 최대 · 최소, 그 절점 줄을 출처로
      const sv = o.nodes.map(n => si(n[7], 'stress'));
      let iMax = -1, iMin = -1;
      sv.forEach((v, i) => { if (v === null) { return; } if (iMax < 0 || v > sv[iMax]!) { iMax = i; } if (iMin < 0 || v < sv[iMin]!) { iMin = i; } });
      g.push(`<text x="${f1(X(xmin) - 60)}" y="${f1(Y(zmax) - 10)}" font-size="10.5" fill="var(--ng)" font-family="var(--mono)">σ 최대 ${numT(sv[iMax]!, `nodes:${iMax}.7`, 'stress')} MPa</text>`);
      g.push(`<text x="${f1(X(xmin) - 60)}" y="${f1(Y(zmin) + 22)}" font-size="10.5" fill="var(--accent)" font-family="var(--mono)">σ 최소 ${numT(sv[iMin]!, `nodes:${iMin}.7`, 'stress')} MPa</text>`);
    }
    if (o.axes && cgx !== null && cgz !== null) {
      const px = X(cgx), py = Y(cgz);
      g.push(`<g class="cg" data-x="${cgx}" data-z="${cgz}"><circle cx="${f1(px)}" cy="${f1(py)}" r="4" fill="none" stroke="var(--axis)"/><line x1="${f1(px - 7)}" y1="${f1(py)}" x2="${f1(px + 7)}" y2="${f1(py)}" stroke="var(--axis)"/><line x1="${f1(px)}" y1="${f1(py - 7)}" x2="${f1(px)}" y2="${f1(py + 7)}" stroke="var(--axis)"/></g>`);
      const scx = o.shear ? si(o.shear.Xs, 'length') : null, scz = o.shear ? si(o.shear.Zs, 'length') : null;
      if (scx !== null && scz !== null) {
        const qx = X(scx), qy = Y(scz);
        g.push(`<g class="sc" data-x="${scx}" data-z="${scz}"><rect x="${f1(qx - 4)}" y="${f1(qy - 4)}" width="8" height="8" fill="none" stroke="var(--warn)" transform="rotate(45 ${f1(qx)} ${f1(qy)})"/>`
          + `<text x="${f1(qx + 8)}" y="${f1(qy + 14)}" font-size="10.5" fill="var(--warn)">전단 중심</text></g>`);
      }
    }
  }
  const defs = '<defs><marker id="arw" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="var(--dimc)"/></marker></defs>';
  return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="단면 보기">${o.mini ? '' : defs}`
    + `<g class="sec-geo" data-nodes="${pts.size}" data-elems="${lines.length}" data-bbox="${xmin},${zmin},${xmax},${zmax}" data-scale="${s}">${g.join('')}</g></svg>`;
}

type Tf = { X: (x: number) => number; Y: (z: number) => number; s?: number };
const COL = 'var(--dimc)';

/** 치수선 하나(mm 의 두 점, 글은 옆에) — data-a · data-b 는 mm */
function leader(k: string, a: P, b: P, label: string, tf: Tf, off: { dx: number; dy: number }, vertical: boolean): string {
  const { X, Y } = tf;
  const x1 = X(a.x) + off.dx, y1 = Y(a.z) + off.dy, x2 = X(b.x) + off.dx, y2 = Y(b.z) + off.dy;
  const ext = vertical
    ? `<line x1="${f1(X(a.x))}" y1="${f1(y1)}" x2="${f1(x1 + Math.sign(off.dx) * 6)}" y2="${f1(y1)}" stroke="${COL}" stroke-width=".8"/><line x1="${f1(X(b.x))}" y1="${f1(y2)}" x2="${f1(x2 + Math.sign(off.dx) * 6)}" y2="${f1(y2)}" stroke="${COL}" stroke-width=".8"/>`
    : `<line x1="${f1(x1)}" y1="${f1(Y(a.z))}" x2="${f1(x1)}" y2="${f1(y1 + Math.sign(off.dy) * 6)}" stroke="${COL}" stroke-width=".8"/><line x1="${f1(x2)}" y1="${f1(Y(b.z))}" x2="${f1(x2)}" y2="${f1(y2 + Math.sign(off.dy) * 6)}" stroke="${COL}" stroke-width=".8"/>`;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const text = vertical
    ? `<text x="${f1(mx + (off.dx < 0 ? -9 : 16))}" y="${f1(my)}" text-anchor="middle" font-size="12" fill="${COL}" font-family="var(--mono)" transform="rotate(-90 ${f1(mx + (off.dx < 0 ? -9 : 16))} ${f1(my)})">${label}</text>`
    : `<text x="${f1(mx)}" y="${f1(my - 7)}" text-anchor="middle" font-size="12" fill="${COL}" font-family="var(--mono)">${label}</text>`;
  return `<g class="lead" data-k="${k}" data-a="${a.x},${a.z}" data-b="${b.x},${b.z}">${ext}<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="${COL}" marker-start="url(#arw)" marker-end="url(#arw)"/>${text}</g>`;
}

/** 지시선(점 → 글) */
function pointer(k: string, at: P, label: string, tf: Tf, dir: { dx: number; dy: number }): string {
  const px = tf.X(at.x), py = tf.Y(at.z);
  return `<g class="lead" data-k="${k}" data-a="${at.x},${at.z}" data-b="${at.x},${at.z}"><circle cx="${f1(px)}" cy="${f1(py)}" r="2" fill="${COL}"/>`
    + `<line x1="${f1(px)}" y1="${f1(py)}" x2="${f1(px + dir.dx)}" y2="${f1(py + dir.dy)}" stroke="${COL}" stroke-width=".8"/>`
    + `<text x="${f1(px + dir.dx + (dir.dx < 0 ? -4 : 4))}" y="${f1(py + dir.dy + 4)}" text-anchor="${dir.dx < 0 ? 'end' : 'start'}" font-size="12" fill="${COL}" font-family="var(--mono)">${label}</text></g>`;
}

function extentLeaders(e: { width: number; height: number }, b: { xmin: number; xmax: number; zmin: number; zmax: number }, tf: Tf): string {
  const wmm = si(e.width, 'length'), hmm = si(e.height, 'length');
  return leader('W', { x: b.xmin, z: b.zmax }, { x: b.xmax, z: b.zmax }, `폭 ${numT(wmm, 'full:section.width', 'length')}`, tf, { dx: 0, dy: -34 }, false)
    + leader('Hc', { x: b.xmin, z: b.zmax }, { x: b.xmin, z: b.zmin }, `높이 ${numT(hmm, 'full:section.height', 'length')}`, tf, { dx: -46, dy: 0 }, true);
}

/** 템플릿 치수 — 자리는 머리말의 규칙(바깥면 = 중심선 끝 ± t/2) */
function templateLeaders(tpl: { name: string; params: Record<string, number> }, all: P[], t: number, tf: Tf, padL = 0): string {
  const p = tpl.params;
  const mm = (k: string) => si(p[k], 'length');
  const lab = (k: string, name = k) => `${name} ${numT(mm(k), `full:section_params.${k}`, 'length')}`;
  const h = t / 2;
  const xs = all.map(q => q.x), zs = all.map(q => q.z);
  const xmin = Math.min(...xs), xmax = Math.max(...xs), zmin = Math.min(...zs), zmax = Math.max(...zs);
  const out: string[] = [];
  const full = ['rhs', 'chs', 'isect', 'tee'].includes(tpl.name);
  if (tpl.name === 'chs') {
    if (p.OD !== undefined) { out.push(leader('OD', { x: xmin - h, z: zmax + h }, { x: xmax + h, z: zmax + h }, lab('OD'), tf, { dx: 0, dy: -30 }, false)); }
  } else if (full) {
    if (p.H !== undefined) { out.push(leader('H', { x: xmin - h, z: zmax + h }, { x: xmin - h, z: zmin - h }, lab('H'), tf, { dx: -40 - padL, dy: 0 }, true)); }
    if (p.B !== undefined) { out.push(leader('B', { x: xmin - h, z: zmax + h }, { x: xmax + h, z: zmax + h }, lab('B'), tf, { dx: 0, dy: -30 }, false)); }
  } else {
    const bottom = tpl.name === 'angle' || tpl.name === 'lipped_angle';
    const zf = bottom ? zmin : zmax;
    const hat = tpl.name === 'hat';
    let webX: number, tipX: number, edgeX: number;
    if (hat) {
      // 햇: 윗면의 양 끝이 모두 웨브 — 윗면 절점의 양 끝 사이
      const fl = all.filter(q => Math.abs(q.z - zf) <= Math.max(t, 1e-6) * 1.01);
      webX = Math.min(...fl.map(q => q.x)); tipX = Math.max(...fl.map(q => q.x)); edgeX = tipX;
    } else {
      // 웨브 = 절점이 가장 많은 세로 열(0.1 mm 격자), 같으면 세로 범위가 긴 쪽. 둥근 모서리의 호 절점은 열을 이루지 않는다.
      const cols = new Map<number, number[]>();
      for (const q of all) { const k = Math.round(q.x * 10) / 10; cols.set(k, [...(cols.get(k) ?? []), q.z]); }
      let best = -1; webX = xmin;
      for (const [x, zz] of cols) { const sc = zz.length * 1e6 + (Math.max(...zz) - Math.min(...zz)); if (sc > best) { best = sc; webX = x; } }
      // 이 플랜지 쪽 절반의 절점 — 플랜지 끝(립이 있으면 립 열)은 웨브에서 먼 쪽 끝
      const halfN = all.filter(q => Math.abs(q.z - zf) <= (zmax - zmin) / 2);
      const hx0 = Math.min(...halfN.map(q => q.x)), hx1 = Math.max(...halfN.map(q => q.x));
      edgeX = hx1 - webX >= webX - hx0 ? hx1 : hx0;
      tipX = edgeX;
    }
    const outer = bottom ? zf - h : zf + h;
    const vert = tpl.name === 'hat' ? 'B' : 'H';
    const horiz = tpl.name === 'hat' ? 'H' : 'B';
    if (p[vert] !== undefined) {
      const left = xmin - h;
      out.push(leader(vert, { x: left, z: zmax + h }, { x: left, z: zmin - h }, lab(vert), tf, { dx: -40 - padL, dy: 0 }, true));
    }
    if (p[horiz] !== undefined) {
      // 바깥-바깥: 웨브 바깥면부터 플랜지 끝까지 — 립이 있으면 립 바깥면(+t/2), 없으면 플랜지 끝 절점(끝면)
      const lipped = hat || (p.D !== undefined && Number(p.D) > 0);
      const a = Math.min(webX, tipX) - (tipX >= webX ? h : (lipped ? h : 0)), b = Math.max(webX, tipX) + (tipX >= webX ? (lipped ? h : 0) : h);
      out.push(leader(horiz, { x: a, z: outer }, { x: b, z: outer }, lab(horiz), tf, { dx: 0, dy: bottom ? 30 : -30 }, false));
    }
    if (p.D !== undefined && Number(p.D) > 0) {
      // 립 = 플랜지 끝 열의 절점 가운데 이 플랜지 쪽 절반(립 C 는 위 · 아래 립이 같은 x 에 있다)
      const half = (zmax - zmin) / 2;
      const lip = all.filter(q => Math.abs(q.x - edgeX) <= t * 1.01 && Math.abs(q.z - zf) <= half);
      const lipEnd = bottom ? Math.max(...lip.map(q => q.z)) : Math.min(...lip.map(q => q.z));
      const side = tipX >= webX ? 1 : -1;
      out.push(leader('D', { x: edgeX + side * h, z: outer }, { x: edgeX + side * h, z: lipEnd }, lab('D'), tf, { dx: side * 28, dy: 0 }, true));
    }
    if (p.t !== undefined) {
      const zm = (zmin + zmax) / 2;
      out.push(pointer('t', { x: webX + (tipX >= webX ? h : -h), z: zm - 0.18 * (zmax - zmin) }, lab('t'), tf, { dx: (tipX >= webX ? 1 : -1) * 46, dy: 26 }));
    }
    if (p.r !== undefined && Number(p.r) > 0) {
      out.push(pointer('r', { x: webX, z: zf }, lab('r'), tf, { dx: (tipX >= webX ? -1 : 1) * 30, dy: bottom ? 34 : -30 }));
    }
  }
  return out.join('');
}
