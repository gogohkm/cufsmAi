/**
 * 찾기(제목 표시줄 · Ctrl+F) — 검토 항목 · 구간 · 절점 · 요소 · 값(단면 성질 · 좌굴 값)을 이름이나 id 로 찾아 그리로 간다.
 * 찾는 것은 지금 화면이 가진 것뿐이다(호스트에 묻지 않는다). 고르기만 한다 — 모델을 바꾸지 않는다.
 */
import { esc } from './dom';
import { allRows, regionLabel, state } from './store';

export interface Hit { label: string; sub: string; tab: 'model' | 'result'; key: string; extra?: { node?: number; elem?: number } }

const PROPS: Array<[string, string]> = [['A', '단면적'], ['Ixx', '단면 2차 모멘트 x'], ['Izz', '단면 2차 모멘트 z'], ['Ixz', ''], ['Sx', '단면계수 x'], ['Sz', '단면계수 z'],
  ['rx', '회전 반지름'], ['rz', '회전 반지름'], ['xcg', '도심'], ['zcg', '도심'], ['thetap', '주축 각 θp'], ['I11', '주축'], ['I22', '주축'], ['J', '비틀림 상수'], ['Cw', '뒴 상수'], ['Xs', '전단 중심'], ['Zs', '전단 중심']];
const DSM: Array<[string, string]> = [['Mcrl', '국부 좌굴'], ['Mcrd', '뒤틀림 좌굴'], ['Mcre', '전체 좌굴'], ['Pcrl', '국부 좌굴'], ['Pcrd', '뒤틀림 좌굴'], ['Pcre', '전체 좌굴'], ['Lcrl', '국부 반파장'], ['Lcrd', '뒤틀림 반파장'], ['My', '항복 모멘트'], ['Py', '항복 축력']];
const PLACES: Array<[string, string, 'model' | 'result', string]> = [
  ['단면', 'section', 'model', 'sec'], ['재료', 'material', 'model', 'mat'], ['경계조건', 'boundary_condition BC', 'model', 'cBC'], ['하중 경우', 'load_case', 'model', 'cLc'],
  ['반파장', 'lengths', 'model', 'cLen'], ['스프링', 'springs', 'model', 'sspr'], ['구속', 'constraints', 'model', 'scon'],
  ['좌굴 해석', 'buckling_analysis', 'result', 'fsm'], ['하중 해석', 'load_analysis', 'result', 'load'], ['부재 검토', 'member_design', 'result', 'chk'],
  ['랩 접합', 'lap', 'result', 'conn:lap'], ['단일 접합', 'connection', 'result', 'conn:one'],
];

/** 찾기 — 대소문자 무시, 이름 · id · 기호의 부분 일치. 40 개까지 */
export function search(q: string): Hit[] {
  const s = q.trim().toLowerCase();
  if (!s) { return []; }
  const has = (...xs: string[]) => xs.some(x => x.toLowerCase().includes(s));
  const out: Hit[] = [];
  for (const [t, id, tab, key] of PLACES) { if (has(t, id)) { out.push({ label: t, sub: id, tab, key }); } }
  for (const r of allRows()) {
    if (has(r.name, r.id, r.where, r.clause ? `§${r.clause}` : '', String(r.us?.name ?? ''))) {
      out.push({ label: `${r.where} · ${r.name}`, sub: `${r.id}${r.clause ? ` · §${r.clause}` : ''}`, tab: 'result', key: r.key });
    }
  }
  state.regions.forEach((rg, i) => {
    const lab = regionLabel(rg.us, rg.si, i);
    if (has(lab, String(rg.us?.id ?? ''), String(rg.us?.kind ?? ''))) {
      const run = state.runs.find(x => x.key === `purlin:${i}`);
      const k = (run?.rows.find(x => x.pass === false) ?? run?.rows[0])?.key;
      if (k) { out.push({ label: `구간 · ${lab}`, sub: String(rg.us?.id ?? ''), tab: 'result', key: k }); }
    }
  });
  const nm = /^(?:절점|node|n)\s*(\d+)$/i.exec(q.trim());
  if (nm) { const n = Number(nm[1]); if (state.nodes.some(x => Number(x[0]) === n)) { out.push({ label: `절점 ${n}`, sub: 'section.node', tab: 'model', key: 'snode', extra: { node: n } }); } }
  const em = /^(?:요소|element|elem|e)\s*(\d+)$/i.exec(q.trim());
  if (em) { const n = Number(em[1]); if (state.elems.some(x => Number(x[0]) === n)) { out.push({ label: `요소 ${n}`, sub: 'section.element', tab: 'model', key: 'selem', extra: { elem: n } }); } }
  for (const [k, t] of PROPS) { if (state.propsSI && has(k, t)) { out.push({ label: `${k} ${t}`.trim(), sub: '단면 성질', tab: 'model', key: 'sec' }); } }
  for (const [k, t] of DSM) { if (state.dsm && has(k, t)) { out.push({ label: `${k} ${t}`, sub: '좌굴 해석 값', tab: 'result', key: 'fsm' }); } }
  return out.slice(0, 40);
}

export function findHtml(q: string, hits: Hit[], cur: number): string {
  return `<div class="find-box"><input id="find-q" type="text" placeholder="검토 항목 · 구간 · 절점 3 · 요소 12 · 값(Mcrd, Sx) · id" value="${esc(q)}" autocomplete="off" spellcheck="false">`
    + `<div class="find-list">${hits.length ? hits.map((h, i) => `<div class="fi${i === cur ? ' sel' : ''}" data-fi="${i}"><span>${esc(h.label)}</span><span class="faint">${esc(h.sub)}</span></div>`).join('')
      : `<div class="fi none">${q.trim() ? '찾은 것 없음' : '이름 · id 로 찾는다 — ↑ ↓ · Enter · Esc'}</div>`}</div></div>`;
}
