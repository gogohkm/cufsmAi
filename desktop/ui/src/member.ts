/**
 * 부재 보기 — 하중 해석 결과(analyze_loads 의 모양, SI 로 바꾼 것)와 퍼린 설계의 구간을 그리는 순수 함수.
 *
 * 무엇을 어디서(모두 엔진 결과 — 화면은 자리와 축척만 정한다):
 *  - 지점 · 랩 끝 · 변곡점: `auto_params.unbraced.supports_ft · lap_ends_ft · inflection_points_ft`(m), 지점 종류 `supports`
 *  - 경간: `spans_ft`, 랩: `laps_per_support[{left_ft, right_ft}]`, 하중: `governing.governing_span_loads_plf`(kN/m) · `governing.combo`
 *  - M · V: `governing.x_diagram`(m) 의 점마다 `M_diagram`(kN·m) · `V_diagram`(kN), 처짐: `deflection.D_diagram`(mm — 같은 점, 사용하중)
 *  - 글로 적는 값: 엔진이 이름 붙인 위치 `governing.locations[{name, x_ft, Mu, Vu, Ru}]`, 지점 반력 `R_envelope_max`, 경간 처짐 `deflection.per_span`
 *  - 판정비 띠: 퍼린 설계의 구간 `regions[{start_ft, end_ft, result.utilization, result.pass}]` — pass 가 없으면 빗금(미검토)
 * 그림이 엔진 값에서 최댓값을 찾지 않는다 — 글자는 엔진이 이름 붙인 위치와 반력 · 처짐에만 단다.
 *
 * 시험이 읽는 표지: `<g class="dg" data-k="M|V|D" data-xs data-ys>`(SI, 점마다), `<g class="rx" data-i data-x data-r>`,
 * `<g class="loc" data-i data-x data-m>`, 띠 `<rect class="bd" data-run data-a data-b data-r data-pass>`, 고른 구간 `<rect class="selr" data-a data-b>`.
 */
import { esc } from './dom';
import { bandVar, tnum, ratioText, sigText } from './format';

export type Row = 'beam' | 'band' | 'M' | 'V' | 'D';
/** lane 0 = 중력(정 · 부모멘트 · 랩), 1 = 양압(uplift) — 엔진의 구간 kind 로 나눈다(겹치는 구간이라 줄을 따로) */
export interface Region { a: number; b: number; ratio: number | null; pass: boolean | null; run: string; label: string; lane: 0 | 1 }

export interface MemberOpt {
  w: number;
  la: any | null;        // SI
  rows: Row[];
  regions: Region[];
  sel?: { a: number; b: number; label: string } | null;
}

const f1 = (v: number) => v.toFixed(1);
const arr = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number) : []);

export function memberSvg(o: MemberOpt): { svg: string; h: number } {
  const W = Math.round(o.w);
  const la = o.la;
  const g = la?.governing;
  const xs = arr(g?.x_diagram);
  const ub = la?.auto_params?.unbraced ?? {};
  const sup = arr(ub.supports_ft);
  const L = sup.length ? Math.max(...sup) : xs.length ? Math.max(...xs) : 0;
  const lanes = o.regions.some(r => r.lane === 1) ? 2 : 1;
  const hgt: Record<Row, number> = { beam: 150, band: 22 + 28 * lanes, M: 170, V: 130, D: 110 };
  const rows = o.rows.filter(r => r !== 'band' || o.regions.length);
  const H = 44 + rows.reduce((a, r) => a + hgt[r], 0) + 10;
  if (!(L > 0)) {
    return { svg: `<svg viewBox="0 0 ${W} 200" data-base="0 0 ${W} 200"><text x="${W / 2}" y="100" text-anchor="middle" fill="var(--text-faint)" font-size="13">하중 해석 결과 없음</text></svg>`, h: 200 };
  }
  const x0 = 80, x1 = W - 40, sx = (x1 - x0) / L;
  const X = (x: number) => x0 + x * sx;
  const out: string[] = [];
  out.push('<defs><pattern id="hatchU" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--bg-view)"/><line x1="0" y1="0" x2="0" y2="7" stroke="var(--unchk)" stroke-width="2.4"/></pattern></defs>');
  if (o.sel) { out.push(`<rect class="selr" data-a="${o.sel.a}" data-b="${o.sel.b}" x="${f1(X(o.sel.a))}" y="4" width="${f1(Math.max(2, X(o.sel.b) - X(o.sel.a)))}" height="${H - 8}" fill="var(--accent)" opacity=".09"/>`); }
  const lapEnds = arr(ub.lap_ends_ft), ips = arr(ub.inflection_points_ft);
  let top = 44;
  const vlines = (yA: number, yB: number) => {
    for (const x of lapEnds) { out.push(`<line x1="${f1(X(x))}" y1="${yA}" x2="${f1(X(x))}" y2="${yB}" stroke="var(--lapc)" stroke-dasharray="3 4"/>`); }
    for (const x of sup) { out.push(`<line x1="${f1(X(x))}" y1="${yA}" x2="${f1(X(x))}" y2="${yB}" stroke="var(--line)"/>`); }
  };
  for (const r of rows) {
    const h = hgt[r], yA = top, yB = top + h;
    if (r === 'beam') {
      const yb = top + 84, ya = yb - 40;
      const wl = arr(g?.governing_span_loads_plf);
      const spans = arr(la?.spans_ft);
      out.push(`<line x1="${X(0)}" y1="${ya}" x2="${f1(X(L))}" y2="${ya}" stroke="var(--loadc)" stroke-width="1.2"/>`);
      const nArr = Math.max(8, Math.round((x1 - x0) / 30));
      // 화살표는 그 경간의 지배 하중 부호를 따른다 — 음(양압, 예: 0.9D+1.0W)이면 위로, 양(중력)이면 아래로. 경간마다 다를 수 있다
      const spanAt = (xf: number) => { let k = 0; for (let j = 0; j < sup.length - 1; j++) { if (xf >= sup[j]) { k = j; } } return Math.min(k, Math.max(0, wl.length - 1)); };
      for (let i = 0; i <= nArr; i++) {
        const xf = L * i / nArr, x = X(xf);
        const w = Number(wl[spanAt(xf)] ?? wl[0]);
        const up = Number.isFinite(w) && w < 0;
        out.push(up
          ? `<path data-dir="up" d="M${f1(x)} ${yb - 5} V${ya} m-3.5 6 l3.5 -6 l3.5 6" fill="none" stroke="var(--loadc)" stroke-width="1.1"/>`
          : `<path data-dir="down" d="M${f1(x)} ${ya} V${yb - 5} m-3.5 -6 l3.5 6 l3.5 -6" fill="none" stroke="var(--loadc)" stroke-width="1.1"/>`);
      }
      out.push(`<text x="${X(0)}" y="${ya - 10}" font-size="12" fill="var(--loadc)">wu ${wl.map((v, i) => tnum(v, { src: `loads:governing.governing_span_loads_plf.${i}`, kind: 'linload', sig: 3 })).join(' · ')} kN/m · ${esc(String(g?.combo ?? ''))}</text>`);
      out.push(`<line x1="${X(0)}" y1="${yb}" x2="${f1(X(L))}" y2="${yb}" stroke="var(--steel)" stroke-width="3.2"/>`);
      const laps = Array.isArray(la?.laps_per_support) ? la.laps_per_support : [];
      laps.forEach((lp: any, i: number) => {
        if (!lp || !Number.isFinite(sup[i])) { return; }
        const a = sup[i] - Number(lp.left_ft ?? 0), b = sup[i] + Number(lp.right_ft ?? 0);
        out.push(`<line x1="${f1(X(a))}" y1="${yb + 5}" x2="${f1(X(b))}" y2="${yb + 5}" stroke="var(--steel)" stroke-width="3.2"/>`);
        out.push(`<text x="${f1(X(sup[i]))}" y="${yb + 58}" font-size="10.5" text-anchor="middle" fill="var(--lapc)">랩 ${tnum(Number(lp.left_ft), { src: `loads:laps_per_support.${i}.left_ft`, kind: 'length_ft', sig: 3 })} | ${tnum(Number(lp.right_ft), { src: `loads:laps_per_support.${i}.right_ft`, kind: 'length_ft', sig: 3 })} m</text>`);
      });
      const kinds: string[] = Array.isArray(la?.supports) ? la.supports : [];
      const R = arr(g?.R_envelope_max);
      sup.forEach((x, i) => {
        const px = X(x), py = yb + 6;
        const k = kinds[i] ?? 'P';
        if (k !== 'N') { out.push(`<path d="M${f1(px)} ${py} l-8 13 h16 z" fill="none" stroke="var(--warn)" stroke-width="1.5"/>`); }
        out.push(`<text x="${f1(px + (i === sup.length - 1 ? -12 : 12))}" y="${py + 13}" font-size="11.5" fill="var(--text-dim)" text-anchor="middle">${String.fromCharCode(65 + i)}</text>`);
        if (Number.isFinite(R[i])) {
          out.push(`<g class="rx" data-i="${i}" data-x="${x}" data-r="${R[i]}"><text x="${f1(px)}" y="${py + 30}" font-size="10.5" text-anchor="middle" fill="var(--text-dim)" font-family="var(--mono)">R ${tnum(R[i], { src: `loads:governing.R_envelope_max.${i}`, kind: 'force', sig: 3 })}</text></g>`);
        }
      });
      spans.forEach((s, i) => {
        const a = sup[i] ?? 0, b = sup[i + 1] ?? a + s;
        out.push(`<text x="${f1((X(a) + X(b)) / 2)}" y="${yb + 44}" font-size="11.5" text-anchor="middle" fill="var(--text-dim)" font-family="var(--mono)">${tnum(s, { src: `loads:spans_ft.${i}`, kind: 'length_ft', sig: 4 })} m</text>`);
      });
    } else if (r === 'band') {
      const bh = 22;
      out.push(`<text x="${x0 - 8}" y="${top + 12 + 15}" font-size="11" text-anchor="end" fill="var(--text-dim)">판정비</text>`);
      if (lanes > 1) { out.push(`<text x="${x0 - 8}" y="${top + 40 + 15}" font-size="11" text-anchor="end" fill="var(--text-dim)">양압</text>`); }
      for (const rg of o.regions) {
        const yb = top + 12 + rg.lane * 28;
        const ng = rg.pass === false;
        const un = rg.pass === null || rg.pass === undefined;
        const fill = un ? 'url(#hatchU)' : bandVar(rg.ratio, ng);
        const on = o.sel && Math.abs(o.sel.a - rg.a) < 1e-9 && Math.abs(o.sel.b - rg.b) < 1e-9;
        out.push(`<rect class="bd" data-pick="run:${esc(rg.run)}" data-run="${esc(rg.run)}" data-a="${rg.a}" data-b="${rg.b}" data-r="${rg.ratio ?? ''}" data-pass="${rg.pass === true ? 'ok' : rg.pass === false ? 'ng' : 'un'}" x="${f1(X(rg.a))}" y="${yb}" width="${f1(Math.max(1, X(rg.b) - X(rg.a)))}" height="${bh}" fill="${fill}" opacity="${un ? 1 : 0.85}" stroke="${on ? 'var(--accent)' : 'var(--bg-view)'}" stroke-width="${on ? 2 : 1}"><title>${esc(rg.label)}</title></rect>`);
        if (typeof rg.ratio === 'number' && X(rg.b) - X(rg.a) > 34) {
          out.push(`<text x="${f1((X(rg.a) + X(rg.b)) / 2)}" y="${yb + 15}" font-size="10" text-anchor="middle" fill="${un ? 'var(--text)' : '#111'}" font-family="var(--mono)" pointer-events="none">${ratioText(rg.ratio, ng)}</text>`);
        }
      }
    } else {
      const key = r === 'M' ? 'M_diagram' : r === 'V' ? 'V_diagram' : 'D_diagram';
      const ys = r === 'D' ? arr(la?.deflection?.D_diagram) : arr(g?.[key]);
      const unit = r === 'M' ? 'kN·m' : r === 'V' ? 'kN' : 'mm';
      const col = r === 'M' ? 'var(--mcol)' : r === 'V' ? 'var(--vcol)' : 'var(--dcol)';
      vlines(yA + 4, yB - 4);
      out.push(`<text x="${x0 - 8}" y="${yA + 16}" font-size="11" text-anchor="end" fill="var(--text-dim)">${r === 'D' ? 'δ' : r} ${unit}</text>`);
      const n = Math.min(xs.length, ys.length);
      if (n < 2) {
        out.push(`<text x="${f1((x0 + x1) / 2)}" y="${f1((yA + yB) / 2)}" text-anchor="middle" font-size="12" fill="var(--text-faint)">${r === 'D' ? '처짐 결과 없음' : '도표 없음'}</text>`);
      } else {
        const vmax = Math.max(1e-12, ...ys.slice(0, n).map(Math.abs));
        const yc = (yA + yB) / 2 + (r === 'D' ? -h * 0.2 : 0), amp = (h / 2 - 22);
        // 부호: 모멘트는 엔진 부호(정모멘트 위), 처짐은 아래 처짐이 음 → 그대로 아래로
        const Y = (v: number) => yc - v / vmax * amp;
        out.push(`<line x1="${X(0)}" y1="${f1(yc)}" x2="${f1(X(L))}" y2="${f1(yc)}" stroke="var(--line)"/>`);
        const pts = Array.from({ length: n }, (_, i) => `${f1(X(xs[i]))},${f1(Y(ys[i]))}`);
        out.push(`<g class="dg" data-k="${r}" data-xs="${xs.slice(0, n).join(',')}" data-ys="${ys.slice(0, n).join(',')}"><polygon points="${f1(X(xs[0]))},${f1(yc)} ${pts.join(' ')} ${f1(X(xs[n - 1]))},${f1(yc)}" fill="${col}" fill-opacity=".16"/>`
          + `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="1.8"/></g>`);
        if (r === 'M') {
          for (const x of ips) { out.push(`<circle cx="${f1(X(x))}" cy="${f1(yc)}" r="3.2" fill="var(--bg-view)" stroke="var(--mcol)" stroke-width="1.4"/>`); }
          const locs = Array.isArray(g?.locations) ? g.locations : [];
          locs.forEach((lc: any, i: number) => {
            // 엔진이 Mu 를 null 로 내면(그 위치의 값 없음) 점 · 값을 그리지 않는다 — 0 으로 읽지 않는다
            if (typeof lc?.x_ft !== 'number' || typeof lc?.Mu !== 'number' || !Number.isFinite(lc.x_ft) || !Number.isFinite(lc.Mu)) { return; }
            const px = X(Number(lc.x_ft)), py = Y(Number(lc.Mu));
            out.push(`<g class="loc" data-i="${i}" data-x="${lc.x_ft}" data-m="${lc.Mu}"><circle cx="${f1(px)}" cy="${f1(py)}" r="2.6" fill="var(--mcol)"/>`
              + `<text x="${f1(px)}" y="${f1(py + (Number(lc.Mu) >= 0 ? -8 : 16))}" font-size="10.5" text-anchor="middle" fill="var(--text)" font-family="var(--mono)">${tnum(Number(lc.Mu), { src: `loads:governing.locations.${i}.Mu`, kind: 'moment_ft', sig: 3 })}</text></g>`);
          });
        }
        if (r === 'V' && n > 0) {
          // 전단의 최대 · 최소 — 엔진 도표 점 가운데 그 값(새로 찾는 값이 아니라 V_diagram 의 한 점을 가리킨다)
          let iMx = 0, iMn = 0;
          for (let i = 1; i < n; i++) { if (ys[i] > ys[iMx]) { iMx = i; } if (ys[i] < ys[iMn]) { iMn = i; } }
          for (const [i, up] of [[iMx, true], [iMn, false]] as Array<[number, boolean]>) {
            out.push(`<text x="${f1(X(xs[i]) + (xs[i] > L / 2 ? -6 : 6))}" y="${f1(Y(ys[i]) + (up ? -6 : 14))}" font-size="10.5" text-anchor="${xs[i] > L / 2 ? 'end' : 'start'}" fill="var(--text)" font-family="var(--mono)">${tnum(ys[i], { src: `loads:governing.V_diagram.${i}`, kind: 'force', sig: 3 })}</text>`);
          }
        }
        if (r === 'D') {
          const ps = Array.isArray(la?.deflection?.per_span) ? la.deflection.per_span : [];
          ps.forEach((d: any, i: number) => {
            if (!Number.isFinite(Number(d?.x_ft))) { return; }
            const px = X(Number(d.x_ft));
            out.push(`<text x="${f1(px)}" y="${f1(yB - 6)}" font-size="10.5" text-anchor="middle" fill="var(--text-dim)" font-family="var(--mono)">${tnum(Number(d.delta_in), { src: `loads:deflection.per_span.${i}.delta_in`, kind: 'length', sig: 3 })} · L/${tnum(Number(d.L_over_delta), { src: `loads:deflection.per_span.${i}.L_over_delta`, kind: 'none' })}</text>`);
          });
        }
        void sigText;
      }
    }
    top += h;
  }
  if (o.sel) {
    const lw = Math.max(150, o.sel.label.length * 7.5), lx = Math.min(X(o.sel.a), x1 - lw);
    out.push(`<rect x="${f1(lx)}" y="${f1(44 + 2)}" width="${f1(lw)}" height="20" rx="3" fill="var(--bg-panel)" stroke="var(--accent)"/>`
      + `<text x="${f1(lx + 8)}" y="${f1(44 + 16)}" font-size="11.5" fill="var(--accent)">${esc(o.sel.label)}</text>`);
  }
  return { svg: `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" role="img" aria-label="부재 보기">${out.join('')}</svg>`, h: H };
}
