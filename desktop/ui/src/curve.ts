/**
 * 좌굴 곡선(서명 곡선) — MCP get_buckling_curve 의 행([반파장 in, 모드 1 LF, 모드 2 LF, …])을 반로그로 그리는 순수 함수.
 * 극소는 화면이 찾지 않는다: 국부 · 뒤틀림 · 전체의 자리와 값은 MCP get_dsm_values 가 준 것(Lcrl · LF_local, Lcrd · LF_dist,
 * Lcre · LF_global, minima 목록) 그대로 찍는다. 모드 분류 띠는 엔진이 [G, D, L, O] % 를 낼 때만, 아니면 「분류 없음」과 엔진의 까닭.
 *
 * 시험이 읽는 표지: 모드 1 의 점 `<circle class="cp" data-i data-len(mm) data-lf>`, 고차 모드 `<polyline class="hm" data-mode>`,
 * 극소 `<g class="mn" data-k="local|dist|global|other" data-len data-lf>`, 분류 `<g class="cls" data-state="bands|none">`,
 * 고른 길이 `<g class="sel" data-i>`. 길이를 고르는 투명 칸 `<rect data-pick="len:<i>">`.
 */
import { esc } from './dom';
import { sigText } from './format';
import { si } from './units';

export interface CurveMark { k: 'local' | 'dist' | 'global' | 'other'; L: number; lf: number; srcL?: string; srcLf?: string; label: string }

export interface CurveOpt {
  w: number; h: number;
  rows: number[][];
  marks: CurveMark[];
  /** 고른 길이의 색인(rows 의 차례) */
  sel?: number | null;
  selMode?: number;
  higher?: boolean;
  /** 모드 1 의 분류(길이마다 [G, D, L, O] %) — 없으면 null */
  classes?: Array<Array<number | null> | null> | null;
  classNote?: string | null;
  yLabel: string;
  mini?: boolean;
}

const f1 = (v: number) => v.toFixed(1);
const CLS = ['var(--clsG)', 'var(--clsD)', 'var(--clsL)', 'var(--unchk)'];

function niceMax(v: number): number {
  if (!(v > 0)) { return 1; }
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) { if (m * p >= v) { return m * p; } }
  return 10 * p;
}

export function curveSvg(o: CurveOpt): string {
  const W = Math.round(o.w), H = Math.round(o.h);
  const rows = o.rows.filter(r => Array.isArray(r) && r.length >= 2 && Number.isFinite(r[0]) && r[0] > 0);
  if (rows.length < 2) {
    return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--text-faint)" font-size="13">곡선 없음</text></svg>`;
  }
  const Ls = rows.map(r => si(r[0], 'length')!);
  const nModes = Math.max(...rows.map(r => r.length - 1));
  const ml = o.mini ? 34 : 64, mr = o.mini ? 10 : 30, mt = o.mini ? 10 : 46, mb = o.mini ? 24 : 52;
  const x0 = ml, x1 = W - mr, y0 = H - mb, y1 = mt;
  const lgMin = Math.log10(Math.min(...Ls)), lgMax = Math.log10(Math.max(...Ls));
  // 세로축: 국부 · 뒤틀림 극소(엔진 값)의 2.5 배까지 — 짧은 반파장 쪽의 큰 값은 잘라 그린다(축척일 뿐)
  const keyLf = o.marks.filter(m => m.k === 'local' || m.k === 'dist').map(m => m.lf).filter(v => v > 0);
  const lf1 = rows.map(r => r[1]).filter(v => Number.isFinite(v) && v > 0);
  const ymax = niceMax(keyLf.length ? Math.min(Math.max(...lf1), 2.5 * Math.max(...keyLf)) : Math.min(Math.max(...lf1), 10 * Math.min(...lf1)));
  const X = (Lmm: number) => x0 + (Math.log10(Lmm) - lgMin) / ((lgMax - lgMin) || 1) * (x1 - x0);
  const Y = (v: number) => y0 - Math.min(Math.max(v, 0), ymax * 1.08) / ymax * (y0 - y1);
  const g: string[] = [];
  const id = `cc${Math.random().toString(36).slice(2, 8)}`;
  const fs = o.mini ? 9.5 : 11;

  // 분류 띠(엔진이 낼 때만) — 그래프 바닥의 얇은 쌓은 막대
  const cls = o.classes;
  const hasCls = !!cls && cls.some(c => Array.isArray(c) && c.some(v => typeof v === 'number'));
  if (!o.mini) {
    if (hasCls) {
      const band: string[] = [];
      const bh = 14;
      for (let i = 0; i < rows.length; i++) {
        const c = cls![i];
        if (!Array.isArray(c)) { continue; }
        const xa = i === 0 ? X(Ls[0]) : (X(Ls[i - 1]) + X(Ls[i])) / 2;
        const xb = i === rows.length - 1 ? X(Ls[i]) : (X(Ls[i]) + X(Ls[i + 1])) / 2;
        let yy = y0;
        c.forEach((v, k) => {
          const p = typeof v === 'number' ? Math.max(0, v) / 100 : 0;
          if (p <= 0) { return; }
          band.push(`<rect x="${f1(xa)}" y="${f1(yy - p * bh)}" width="${f1(Math.max(0.5, xb - xa))}" height="${f1(p * bh)}" fill="${CLS[k]}" opacity=".85"/>`);
          yy -= p * bh;
        });
      }
      g.push(`<g class="cls" data-state="bands">${band.join('')}</g>`);
    } else {
      g.push(`<g class="cls" data-state="none" data-note="${esc(o.classNote ?? '')}"></g>`);
    }
  }
  // 격자 · 축
  const decs: number[] = [];
  for (let e = Math.floor(lgMin); e <= Math.ceil(lgMax); e++) { for (const m of [1, 2, 5]) { const L = m * 10 ** e; if (Math.log10(L) >= lgMin - 1e-9 && Math.log10(L) <= lgMax + 1e-9) { decs.push(L); } } }
  for (const L of decs) {
    const dec = Math.abs(Math.log10(L) - Math.round(Math.log10(L))) < 1e-9;
    g.push(`<line x1="${f1(X(L))}" y1="${y1}" x2="${f1(X(L))}" y2="${y0}" stroke="var(--line${dec ? '' : '-soft'})"/>`);
    if (dec || !o.mini) { g.push(`<text x="${f1(X(L))}" y="${y0 + (o.mini ? 13 : 16)}" font-size="${fs}" text-anchor="middle" fill="var(--text-${dec ? 'dim' : 'faint'})" font-family="var(--mono)">${sigText(L, 3).replace(/ /g, '')}</text>`); }
  }
  const step = ymax / (o.mini ? 2 : 6);
  for (let v = 0; v <= ymax + 1e-9; v += step) {
    g.push(`<line x1="${x0}" y1="${f1(Y(v))}" x2="${x1}" y2="${f1(Y(v))}" stroke="var(--line-soft)"/>`);
    g.push(`<text x="${x0 - 6}" y="${f1(Y(v) + 4)}" font-size="${fs}" text-anchor="end" fill="var(--text-faint)" font-family="var(--mono)">${sigText(Number(v.toPrecision(6)), 3)}</text>`);
  }
  g.push(`<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="var(--text-faint)"/><line x1="${x0}" y1="${y1}" x2="${x0}" y2="${y0}" stroke="var(--text-faint)"/>`);
  if (ymax >= 1) { g.push(`<line x1="${x0}" y1="${f1(Y(1))}" x2="${x1}" y2="${f1(Y(1))}" stroke="var(--text-dim)" stroke-dasharray="6 4"/>`); }
  // 곡선(모드 1 + 고차)
  g.push(`<clipPath id="${id}"><rect x="${x0}" y="${y1 - 2}" width="${x1 - x0}" height="${y0 - y1 + 2}"/></clipPath><g clip-path="url(#${id})">`);
  if (o.higher && !o.mini) {
    for (let m = nModes; m >= 2; m--) {
      const pts = rows.map((r, i) => (Number.isFinite(r[m]) ? `${f1(X(Ls[i]))},${f1(Y(r[m]))}` : '')).filter(Boolean).join(' ');
      g.push(`<polyline class="hm" data-mode="${m}" points="${pts}" fill="none" stroke="var(--curve)" stroke-opacity="${(0.18 + 0.25 / m).toFixed(2)}" stroke-width="1"/>`);
    }
  }
  const p1 = rows.map((r, i) => `${f1(X(Ls[i]))},${f1(Y(r[1]))}`).join(' ');
  g.push(`<polyline class="c1" points="${p1}" fill="none" stroke="var(--curve)" stroke-width="${o.mini ? 1.6 : 2.2}"/>`);
  if (!o.mini) {
    g.push(rows.map((r, i) => `<circle class="cp" data-i="${i}" data-len="${Ls[i]}" data-lf="${r[1]}" cx="${f1(X(Ls[i]))}" cy="${f1(Y(r[1]))}" r="1.8" fill="var(--curve)"/>`).join(''));
  }
  g.push('</g>');
  // 고른 길이
  if (o.sel !== null && o.sel !== undefined && rows[o.sel]) {
    const m = Math.min(Math.max(1, o.selMode ?? 1), rows[o.sel].length - 1);
    const xs = X(Ls[o.sel]), ys = Y(rows[o.sel][m]);
    g.push(`<g class="sel" data-i="${o.sel}" data-mode="${m}"><line x1="${f1(xs)}" y1="${f1(ys)}" x2="${f1(xs)}" y2="${y0}" stroke="var(--accent)" stroke-dasharray="4 3"/>`
      + `<circle cx="${f1(xs)}" cy="${f1(ys)}" r="${o.mini ? 4 : 6}" fill="var(--accent)"/>`
      + (o.mini ? '' : `<text x="${f1(xs)}" y="${y0 + 30}" font-size="11" text-anchor="middle" fill="var(--accent)" font-family="var(--mono)">${sigText(Ls[o.sel], 4)}</text>`) + '</g>');
  }
  // 극소(엔진 값)
  for (const mk of o.marks) {
    const Lmm = si(mk.L, 'length');
    if (Lmm === null || !(mk.lf > 0) || Math.log10(Lmm) < lgMin - 1e-9 || Math.log10(Lmm) > lgMax + 1e-9) { continue; }
    const xm = X(Lmm), ym = Y(mk.lf);
    const shape = mk.k === 'global'
      ? `<path d="M${f1(xm)} ${f1(ym - 7)} l7 12 h-14 z" fill="var(--bg-view)" stroke="var(--text)" stroke-width="1.4"/>`
      : `<circle cx="${f1(xm)}" cy="${f1(ym)}" r="${mk.k === 'other' ? 3.5 : 5}" fill="var(--bg-view)" stroke="${mk.k === 'other' ? 'var(--text-dim)' : 'var(--text)'}" stroke-width="1.6"/>`;
    const lab = o.mini || mk.k === 'other' ? '' : `<text x="${f1(xm + (mk.k === 'global' ? -10 : 0))}" y="${f1(mk.k === 'global' ? ym - 16 : ym + 26)}" font-size="11.5" fill="var(--text-dim)" font-family="var(--mono)" text-anchor="${mk.k === 'global' ? 'end' : 'middle'}">${mk.label}</text>`;
    g.push(`<g class="mn" data-k="${mk.k}" data-len="${Lmm}" data-lf="${mk.lf}">${shape}${lab}</g>`);
  }
  // 길이 고르기 칸(투명)
  if (!o.mini) {
    const picks: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const xa = i === 0 ? x0 : (X(Ls[i - 1]) + X(Ls[i])) / 2, xb = i === rows.length - 1 ? x1 : (X(Ls[i]) + X(Ls[i + 1])) / 2;
      picks.push(`<rect data-pick="len:${i}" x="${f1(xa)}" y="${y1}" width="${f1(Math.max(1, xb - xa))}" height="${y0 - y1}" fill="transparent"/>`);
    }
    g.push(`<g class="picks">${picks.join('')}</g>`);
    g.push(`<text x="${x1}" y="${y0 + 34}" font-size="11" text-anchor="end" fill="var(--text-faint)">반파장 (mm)</text>`);
    g.push(`<text x="${x0 + 6}" y="${y1 + 12}" font-size="11" fill="var(--text-faint)">${esc(o.yLabel)}</text>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" data-base="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="좌굴 곡선" data-ymax="${ymax}">${g.join('')}</svg>`;
}
