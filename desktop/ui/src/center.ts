/**
 * 가운데 「보기」(U1 범위) — 고른 것에 따라:
 *  - 모델 · 단면 성질 · 해석 조건: 축척대로 그린 단면(절점 · 요소 = MCP get_nodes · get_elements) + 표 서랍(절점 · 요소)
 *  - 결과 · 부재 검토: 판정비 표(엔진의 한계상태 판정 그대로) + U2 자리
 *  - 결과 · 좌굴 해석: 단면 + 「좌굴 곡선 · 모드 형상 — U2」 자리
 *  - 그 밖(하중 해석 · 접합부 · 업무 · 문서): 그 그림의 U2 자리 + 단면
 * 보기 칩(모드 형상 · 좌굴 곡선 · 부재 · 판정비)과 그림들은 U2 에서 그린다 — 지금은 꺼진 칩과 이름 붙은 자리로 둔다.
 */
import { esc, tip } from './dom';
import { bandVar, num, ratio, verdictOf } from './format';
import { sectionSvg } from './section';
import { state, type CheckRow } from './store';
import { si } from './units';

export type View = 'section' | 'checks' | 'buckling' | 'placeholder';

export interface CenterOpts { labels: boolean; elems: boolean; dims: boolean; axes: boolean }
export const opts: CenterOpts = { labels: true, elems: true, dims: true, axes: true };

export function viewOf(key: string): { view: View; what?: string } {
  if (key === 'chk' || key.startsWith('chk:') || key.includes('#')) { return { view: 'checks' }; }
  if (key === 'fsm' || key.startsWith('fsm:')) { return { view: 'buckling' }; }
  if (key === 'load') { return { view: 'placeholder', what: '부재 보기 — 보 개략도 · M · V · 처짐도' }; }
  if (key === 'conn') { return { view: 'placeholder', what: '접합 도면 — 랩 측면도 · Cut A-A · 패스너 배치' }; }
  if (['rpt', 'brpt', 'vtab', 'src', 'pub'].includes(key)) { return { view: 'placeholder', what: '문서 미리보기' }; }
  return { view: 'section' };
}

const VSEL_OFF = '그림 보기는 다음 단계(U2)에서 그린다';
function vsel(on: string): string {
  const items: Array<[string, boolean]> = [['단면', true], ['모드 형상', false], ['좌굴 곡선', false], ['부재', false], ['판정비', true]];
  return `<span class="vsel"${tip('보기 구성. 단면 · 모드 형상 · 좌굴 곡선 · 부재 · 판정비')}>${items.map(([t, live]) => `<span class="${t === on ? 'on' : ''}${live ? '' : ' off'}"${live ? '' : tip(VSEL_OFF)}>${t}</span>`).join('')}</span>`;
}

function sectionBlock(w: number, h: number, hud = true): string {
  const svg = sectionSvg({
    w, h, nodes: state.nodes, elems: state.elems, cg: state.props ? { x: state.props.xcg, z: state.props.zcg } : null,
    extent: state.full?.section ?? null, labels: opts.labels, elemLabels: opts.elems, dims: opts.dims, axes: opts.axes,
  });
  const chip = (k: keyof CenterOpts, t: string, tp?: string) => `<span class="chip${opts[k] ? ' on' : ''}" data-opt="${k}"${tip(tp)}>${t}</span>`;
  return `<div class="dv" data-draw="section">${svg}`
    + (hud ? `<div class="hud tl">${vsel('단면')}${chip('dims', '치수', '중심선 폭 · 높이(MCP get_full_state)')}${chip('labels', '절점')}${chip('elems', '요소', '회색 기울임 숫자')}${chip('axes', '축', '도심(MCP 단면 성질의 xcg · zcg)과 x · z 축')}</div>`
      + `<div class="hud bl"><span class="cap"${tip('절점 좌표(in)를 mm 로 바꿔 그렸다. 선 굵기는 두께 t 를 축척대로')}>mm · 중심선 형상 · 절점 ${state.nodes.length} · 요소 ${state.elems.length}</span></div>` : '')
    + '</div>';
}

function drawer(): string {
  const nodes = state.nodes.map((n, i) => `<tr><td>${esc(n[0])}</td><td class="r">${num(si(n[1], 'length'), { src: `nodes:${i}.1`, kind: 'length', unit: false })}</td>`
    + `<td class="r">${num(si(n[2], 'length'), { src: `nodes:${i}.2`, kind: 'length', unit: false })}</td><td class="r">${num(si(n[7], 'stress'), { src: `nodes:${i}.7`, kind: 'stress', unit: false })}</td></tr>`).join('');
  const elems = state.elems.map((e, i) => `<tr><td>${esc(e[0])}</td><td class="r">${esc(e[1])}</td><td class="r">${esc(e[2])}</td>`
    + `<td class="r">${num(si(e[3], 'length'), { src: `elems:${i}.3`, kind: 'length', unit: false })}</td><td class="r">${esc(e[4])}</td></tr>`).join('');
  return '<div class="drawer">'
    + `<header><b>절점 · 요소</b><span class="chip on">절점 ${state.nodes.length}</span><span class="chip on">요소 ${state.elems.length}</span>`
    + `<span class="chip">스프링 ${esc(state.full?.nsprings ?? '—')}</span><span class="chip">구속 ${esc(state.full?.nconstraints ?? '—')}</span><span class="sp"></span>`
    + `<span class="faint"${tip('MCP get_nodes · get_elements 와 같은 값을 mm · MPa 로')}>mm · MPa · 절점 좌표계</span></header>`
    + '<div class="dtabs">'
    + `<div><table class="t" data-table="nodes"><thead><tr><th>절점</th><th class="r">x</th><th class="r">z</th><th class="r"${tip('기준 응력 분포(절점 응력)')}>σ MPa</th></tr></thead><tbody>${nodes}</tbody></table></div>`
    + `<div><table class="t" data-table="elems"><thead><tr><th>요소</th><th class="r">i</th><th class="r">j</th><th class="r">t mm</th><th class="r">재료</th></tr></thead><tbody>${elems}</tbody></table></div>`
    + '</div></div>';
}

function placeholder(what: string, short = false): string {
  return `<div class="dv ph${short ? ' short' : ''}"><div class="ph-box"${tip('그림 보기는 다음 단계(U2)에서 그린다. 수치는 오른쪽 정보 창에 있다')}><b>${esc(what)}</b><span>U2 에서 그린다</span></div></div>`;
}

function checksTable(sel: string): string {
  const s = state.stages.chk;
  if (s.state !== 'ok') {
    return `<div class="dv ph"><div class="ph-box"><b>${s.state === 'stale' ? '낡음 — 결과를 지웠다' : '아직 평가 안 함'}</b><span>${esc(s.note)}</span></div></div>`;
  }
  const rows: string[] = [];
  for (const run of state.runs) {
    if (!run.rows.length && !run.notChecked.length) { continue; }
    const ov = verdictOf(run.overall, '판정 없음');
    rows.push(`<tr class="grp"><td colspan="5">${esc(run.label)} · 전체 <span class="verdict ${ov.cls}">${ov.text}</span>${run.governing ? ` · 지배 ${esc(run.governing)}` : ''}</td></tr>`);
    for (const r of run.rows) { rows.push(checkRow(r, sel)); }
    for (const t of run.notApplicable) { rows.push(`<tr class="na"><td><span class="dot"></span></td><td>${esc(run.where)}</td><td>${esc(t)}</td><td></td><td class="r faint">해당 없음</td></tr>`); }
    for (const t of run.notChecked) { rows.push(`<tr class="out"><td><span class="dot"></span></td><td>${esc(run.where)}</td><td class="faint">${esc(t)}</td><td></td><td class="r faint"${tip('엔진이 이 검토의 범위 밖으로 둔 것 — 판정에 들어가지 않는다')}>범위 밖</td></tr>`); }
  }
  return `<div class="dv vt-wrap"><div class="vt-head"><b>판정비</b><span class="faint"${tip('엔진의 limit_state_checks · not_evaluated · not_checked 를 그 차례대로. 판정 차례: NG > 미검토 > OK')}>위치 · 한계상태 · 엔진 판정</span><span class="sp"></span>`
    + `<div class="legend"${tip('판정비 구간색. 미검토는 합격이 아니다')}><i style="background:var(--r1)"></i><span>&lt;0.50</span><i style="background:var(--r2)"></i><span>0.75</span><i style="background:var(--r3)"></i><span>0.90</span><i style="background:var(--r4)"></i><span>1.00</span><i style="background:var(--r5)"></i><span>1.25</span><i style="background:var(--r6)"></i><span>NG</span><i class="un"></i><span>미검토</span></div></div>`
    + `<table class="t vt" data-table="checks"><thead><tr><th></th><th>위치</th><th>한계상태</th><th>판정비</th><th class="r">판정</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function checkRow(r: CheckRow, sel: string): string {
  const v = verdictOf(r.pass);
  const ng = r.pass === false;
  const bar = r.kind === 'ls' && typeof r.ratio === 'number'
    ? `<div class="ratio"><div class="track"><div class="fill" style="width:${Math.min(100, r.ratio * 100).toFixed(1)}%;background:${bandVar(r.ratio, ng)}"></div></div>${ratio(r.ratio, ng, r.src)}</div>`
    : '<div class="ratio"><div class="track un"></div><span class="faint">평가 못 함</span></div>';
  return `<tr class="ck${r.key === sel ? ' on' : ''}" data-k="${esc(r.key)}" data-verdict="${r.kind === 'ne' ? 'ne' : v.cls}"><td><span class="dot ${v.cls}"></span></td><td>${esc(r.where)}</td><td>${esc(r.name)}</td><td>${bar}</td>`
    + `<td class="r verdict ${v.cls}">${r.kind === 'ne' ? '미검토' : v.text}</td></tr>`;
}

/** 그림 칸의 크기(px) — 그 비율로 viewBox 를 잡아 좁은 창에서도 단면이 칸을 채운다 */
export function centerHtml(key: string, size: { w: number; h: number } = { w: 1240, h: 900 }): { html: string; cls: string } {
  const v = viewOf(key);
  const W = Math.max(420, Math.round(size.w));
  if (v.view === 'checks') {
    return { html: checksTable(key) + `<div class="split">${placeholder('부재 보기 · 판정비 띠', true)}${placeholder('모드 형상 · 좌굴 곡선', true)}</div>`, cls: 'stack s64' };
  }
  if (v.view === 'buckling') {
    return { html: sectionBlock(W, Math.max(300, Math.round(size.h / 2))) + placeholder('좌굴 곡선 · 모드 형상'), cls: 'stack' };
  }
  if (v.view === 'placeholder') {
    return { html: placeholder(v.what ?? '보기') + sectionBlock(W, Math.max(300, Math.round(size.h / 2)), false), cls: 'stack' };
  }
  return { html: sectionBlock(W, Math.max(300, Math.round(size.h - 300))) + drawer(), cls: 'drawer-open' };
}
