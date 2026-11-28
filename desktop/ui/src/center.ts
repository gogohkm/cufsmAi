/**
 * 가운데 「보기」(U2) — 고른 것에 따라 그림 하나 또는 둘(위 · 아래)과 표 서랍.
 *
 * | 고른 것 | 그림 | 표 서랍 |
 * |---|---|---|
 * | 모델 · 단면 성질 | 단면(치수 H · B · D · t · r, 절점 · 요소, 도심 · 주축 · 전단 중심, 응력) | 절점 · 요소 |
 * | 좌굴 해석 | 모드 형상(고른 반파장, 국부 · 뒤틀림 · 전체 썸네일) / 좌굴 곡선 | 곡선 점 · 극소 |
 * | 하중 해석 | 부재(보 개략 · M · V · 처짐) | 위치별 소요강도 · 도표 점 · 지점 반력 |
 * | 부재 검토(퍼린) | 부재(보 · 판정비 띠 · M) / 모드 형상 · 좌굴 곡선 | 판정비 · 구간 |
 * | 부재 검토(단일 부재) | 판정비 표 / 모드 형상 · 좌굴 곡선 | 판정비 |
 * | 접합부 | 접합 도면(랩 · 단일) | 패스너 · 한계상태 · 계산 단계 |
 *
 * 보기 칩(단면 · 모드 형상 · 좌굴 곡선 · 부재 · 판정비 · 접합 도면)으로 바꿀 수 있다 — 다른 가지를 고르면 그 가지의 기본으로 돌아간다.
 * 그림 위의 수는 모두 엔진 · 호스트에서 온 값이고 `data-src` 를 단다(format.ts). 3D 모드 형상은 이 화면에 없다(README — 다리 변경이 필요).
 */
import { isValKey, reportKindOf, reportView, valView, vtabView } from './checklist';
import { docView } from './docs';
import { damageView } from './damage';
import { curveSvg, type CurveMark } from './curve';
import { esc, tip } from './dom';
import { drawerHtml, type DTable } from './drawer';
import { bandVar, hhmm, none, num, ratio, sigText, tnum, tnumX, verdictOf } from './format';
import { connSvg, lapFasteners, lapSvg } from './lap';
import { memberSvg, type PointBar, type Region, type Row } from './member';
import { FAMILY_KO } from './names';
import { sectionSvg } from './section';
import { memberRuns, regionLabel, regionSecTag, rowOfKey, state, type CheckRow, type Run } from './store';
import { demandCapacity, unText } from './sheet';
import { ROLE_KO } from './names';
import { si } from './units';
import { checkRatioHtml, fieldText, pageOf, utilHtml } from './notices';
import { refKey, work } from './work';
import { alts, sideBySide, visibleAlts } from './alts';
import { keyOfItem } from './follow';
import { baseOf, changeOf, chg, KIND_RESULT_KO, sinceBase, timeline, valText, whoText, wholeSection, type Change } from './changes';
import { psecOn, psecView } from './spansecs';

export type V = 'section' | 'mode' | 'curve' | 'member' | 'verdict' | 'lap' | 'doc';
export interface CenterOpts { labels: boolean; elems: boolean; dims: boolean; axes: boolean; stress: boolean; higher: boolean; M: boolean; V: boolean; D: boolean; force: boolean; modeNodes: boolean; mode3d: boolean }
export const opts: CenterOpts = { labels: true, elems: true, dims: true, axes: true, stress: false, higher: true, M: true, V: true, D: true, force: true, modeNodes: false, mode3d: false };

/** 모드 형상의 반파장 · 모드(곡선을 누르거나 극소 썸네일 · 트리에서 고른다) */
export const modeSel: { len: number | null; mode: number; fromKey: string } = { len: null, mode: 1, fromKey: '' };
let override: { group: string; views: V[] } | null = null;

export type Group = 'model' | 'fsm' | 'load' | 'chk' | 'conn' | 'doc' | 'other';
export function groupOf(key: string): Group {
  // 점검(K3)은 결과 탭에 있지만 보기 어휘로는 「그 밖(other) · 문서(doc)」 — 표 하나다
  if (isValKey(key)) { return 'other'; }
  if (key.startsWith('lap#') || key.startsWith('conn#')) { return 'conn'; }
  if (key === 'chk' || key.startsWith('chk:') || key.includes('#') || key === 'dc' || key.startsWith('dc:')) { return 'chk'; }
  // 2026-11-28 결정 S8: 퍼린 결과의 단면마다 — 그 단면의 서명곡선(보기 어휘로는 좌굴 곡선)
  if (key === 'fsm' || key.startsWith('fsm:') || key === 'psec' || key.startsWith('psec:')) { return 'fsm'; }
  if (key === 'load' || key.startsWith('load:')) { return 'load'; }
  if (key === 'conn' || key.startsWith('conn:')) { return 'conn'; }
  if (['rpt', 'brpt', 'vtab', 'src', 'pub'].includes(key)) { return 'doc'; }
  if (['ask', 'rep', 'chg', 'ins', 'todo', 'insp', 'val', 'alt', 'pub'].includes(key) || /^(chg|work|asmr|srcr|alt|doc|iss|pubf|log|todo|insp|ask):/.test(key) || key === 'asm:reg' || key === 'src:unreg' || key === 'dmg') { return 'other'; }
  return 'model';
}

function defaultViews(g: Group): V[] {
  switch (g) {
    case 'fsm': return ['mode', 'curve'];
    case 'load': return ['member'];
    case 'chk': return state.regions.length && state.loads ? ['member', 'mode', 'curve'] : ['verdict', 'mode', 'curve'];
    case 'conn': return ['lap'];
    case 'doc': return ['doc'];
    default: return ['section'];
  }
}

export function setViews(key: string, views: V[]): void { override = { group: groupOf(key), views }; }
export function viewsFor(key: string): V[] {
  if (isValKey(key) || ['rpt', 'brpt', 'vtab', 'src', 'pub'].includes(key)) { return ['doc']; }
  if (key === 'psec' || key.startsWith('psec:')) { return ['curve']; }
  const g = groupOf(key);
  if (override && override.group !== g) { override = null; }
  return override?.views ?? defaultViews(g);
}

// ── 보기 칩 ───────────────────────────────────────────────────────
const VSEL: Array<[V, string]> = [['section', '단면'], ['mode', '모드 형상'], ['curve', '좌굴 곡선'], ['member', '부재'], ['verdict', '판정비'], ['lap', '접합 도면']];
function vsel(views: V[]): string {
  return `<span class="vsel"${tip('보기 구성 — 둘까지 위아래로 쌓는다. 다른 가지를 고르면 그 가지의 기본으로')}>${VSEL.map(([k, t]) => `<span class="${views.includes(k) ? 'on' : ''}" data-view="${k}">${t}</span>`).join('')}</span>`;
}
const chip = (k: keyof CenterOpts, t: string, tp?: string) => `<span class="chip${opts[k] ? ' on' : ''}" data-opt="${k}"${tip(tp)}>${t}</span>`;
const fitBtn = (key: string) => `<span class="btn ghost" data-fit="${key}"${tip('처음 크기 · 자리로  (두 번 누르기도 같다)')}>전체 맞춤</span>`;
function honest(title: string, why: string, zoom = ''): string {
  return `<div class="dv ph"${zoom}><div class="ph-box"><b>${esc(title)}</b><span>${esc(why)}</span></div></div>`;
}

// ── 단면 ──────────────────────────────────────────────────────────
function tplOf(): { name: string; params: Record<string, number> } | null {
  // 호스트 상태(get_full_state — K4a)의 템플릿 · 치수
  const f = state.full;
  const t = String(f?.section_template ?? '');
  if (!f?.section_params || !t || t.startsWith('custom')) { return null; }
  return { name: t, params: f.section_params };
}

function sectionView(w: number, h: number, first: boolean, views: V[]): string {
  const svg = sectionSvg({
    w, h, nodes: state.nodes, elems: state.elems, props: state.props, shear: state.cutwp, extent: state.full?.section ?? null, template: tplOf(),
    labels: opts.labels, elemLabels: opts.elems, dims: opts.dims, axes: opts.axes, stress: opts.stress,
  });
  return `<div class="dv" data-draw="section" data-zoom="section">${svg}`
    + `<div class="hud tl">${first ? vsel(views) : ''}${chip('dims', '치수', tplOf() ? '템플릿 치수 H · B · D · t · r(호스트 모델)' : '중심선 폭 · 높이(MCP get_full_state)')}${chip('labels', '절점')}${chip('elems', '요소', '회색 기울임 숫자')}`
    + `${chip('axes', '축', '도심 · 주축 1 · 2 · θp(MCP 단면 성질) · 전단 중심(MCP get_cutwp)')}${chip('stress', '응력', '절점 응력(모델의 기준 응력 분포) — 압축 빨강 · 인장 파랑')}</div>`
    + `<div class="hud tr">${fitBtn('section')}</div>`
    + `<div class="hud bl"><span class="cap"${tip('절점 좌표(in)를 mm 로 바꿔 그렸다. 선 굵기는 두께 t 를 축척대로. 치수선의 자리 규칙은 README')}>mm · 중심선 형상 · 절점 ${state.nodes.length} · 요소 ${state.elems.length}</span></div></div>`;
}

// ── 좌굴: 표지 · 모드 형상 · 곡선 ────────────────────────────────────
function dsmFam(): { fam: string; d: any; us: any } | null {
  const dsm = state.dsm;
  if (!dsm) { return null; }
  return { fam: dsm.family, d: dsm.si?.[dsm.family] ?? {}, us: dsm.us?.[dsm.family] ?? {} };
}

/** 엔진 극소(국부 · 뒤틀림 · 전체 · 그 밖) — get_dsm_values 의 값 그대로 */
export function marks(): CurveMark[] {
  const f = dsmFam();
  if (!f) { return []; }
  const { fam, d, us } = f;
  const out: CurveMark[] = [];
  const lab = (name: string, lfKey: string, lKey: string) => `${name} ${tnum(d[lfKey], { src: `dsm:${fam}.${lfKey}`, kind: 'none', sig: 3 })} · ${tnum(d[lKey], { src: `dsm:${fam}.${lKey}`, kind: 'length' })}`;
  if (us.local_detected !== false && us.Lcrl > 0) { out.push({ k: 'local', L: us.Lcrl, lf: us.LF_local, label: lab('국부', 'LF_local', 'Lcrl') }); }
  if (us.dist_detected !== false && us.Lcrd > 0) { out.push({ k: 'dist', L: us.Lcrd, lf: us.LF_dist, label: lab('뒤틀림', 'LF_dist', 'Lcrd') }); }
  if (us.Lcre > 0 && us.LF_global > 0) { out.push({ k: 'global', L: us.Lcre, lf: us.LF_global, label: lab('전체', 'LF_global', 'Lcre') }); }
  const known = out.map(m => m.L);
  (Array.isArray(us.minima) ? us.minima : []).forEach((m: any) => {
    if (m && m.length > 0 && !known.some(L => Math.abs(L - m.length) < 1e-9)) { out.push({ k: 'other', L: m.length, lf: m.load_factor, label: '' }); }
  });
  return out;
}

/** 엔진의 그 길이(in)가 곡선 행의 몇째인가 — 같은 값, 없으면 가장 가까운 행 */
export function rowOfLength(L: number): number | null {
  const rows = state.analysis?.curve ?? [];
  if (!rows.length || !(L > 0)) { return null; }
  let best = 0, bd = Infinity;
  rows.forEach((r, i) => { const dd = Math.abs(Math.log(r[0] / L)); if (dd < bd) { bd = dd; best = i; } });
  return best;
}

/** 트리의 좌굴 줄을 고르면 그 극소로(한 번만 — 그 뒤 곡선을 누른 것은 지키는다) */
export function syncModeFromKey(key: string): void {
  if (key === modeSel.fromKey) { return; }
  modeSel.fromKey = key;
  const f = dsmFam();
  if (!f) { return; }
  const L = key === 'fsm:l' ? f.us.Lcrl : key === 'fsm:g' ? f.us.Lcre : (groupOf(key) === 'fsm' || groupOf(key) === 'chk') ? (f.us.Lcrd > 0 ? f.us.Lcrd : f.us.Lcrl) : null;
  if (L > 0) { modeSel.len = rowOfLength(L); modeSel.mode = 1; }
}

function analysisState(): { ok: boolean; title: string; why: string } {
  const st = state.stages.fsm;
  if (st.state === 'stale') { return { ok: false, title: '낡음 — 결과를 지웠다', why: st.note }; }
  if (st.state === 'run') { return { ok: false, title: '해석 중', why: '호스트가 좌굴 해석을 돌리고 있다' }; }
  if (!state.analysis) { return { ok: false, title: '좌굴 해석 결과 없음', why: state.analysisErr ?? 'Claude 에게 말로, 또는 편집 상태의 「해석 실행」' }; }
  return { ok: true, title: '', why: '' };
}

function modeVec(len: number, mode: number): number[] | null {
  const sh = state.analysis?.shapes?.[len];
  if (!Array.isArray(sh)) { return null; }
  return sh.map(row => (Array.isArray(row) ? Number(row[mode - 1]) : Number(row)));
}

function modeView(w: number, h: number, first: boolean, views: V[]): string {
  const a = analysisState();
  if (!a.ok) { return honest(a.title, a.why); }
  const an = state.analysis!;
  if (!an.shapes) { return honest('모드 형상 없음', '호스트가 보낸 해석 결과에 모드 형상이 없다'); }
  if (modeSel.len === null || !an.curve[modeSel.len]) { modeSel.len = rowOfLength(dsmFam()?.us.Lcrd > 0 ? dsmFam()!.us.Lcrd : an.curve[0][0]) ?? 0; }
  const i = modeSel.len, m = Math.min(modeSel.mode, (an.curve[i]?.length ?? 2) - 1);
  const vec = modeVec(i, m);
  const svg = sectionSvg({ w, h, nodes: an.nodes, elems: an.elems, labels: opts.modeNodes, stress: opts.stress, mode: vec ? { vec, nodes: an.nodes } : null, axes: false, dims: false });
  const L = si(an.curve[i][0], 'length');
  const mk = marks();
  const thumb = (k: 'local' | 'dist' | 'global', name: string) => {
    const x = mk.find(q => q.k === k);
    if (!x) { return `<div class="mth off"${tip('엔진이 이 극소를 내지 않았다')}><div class="dv"></div>${name}<b>없음</b></div>`; }
    const row = rowOfLength(x.L);
    const v = row === null ? null : modeVec(row, 1);
    const mini = v ? sectionSvg({ w: 200, h: 150, nodes: an.nodes, elems: an.elems, mode: { vec: v, nodes: an.nodes }, mini: true }) : '';
    return `<div class="mth${row === i && m === 1 ? ' on' : ''}" data-pick="len:${row}"><div class="dv">${mini}</div>${name}<b>${sigText(x.lf, 3)} · ${sigText(si(x.L, 'length')!, 4)}</b></div>`;
  };
  const sel = mk.find(q => rowOfLength(q.L) === i && m === 1);
  // 좁은 칸(템플릿 04 · 960)에서는 작은 그림 대신 극소 칩 — 그림을 가리지 않게
  const narrow = w < 620;
  const kchip = (k: 'local' | 'dist' | 'global', name: string) => {
    const x = mk.find(q => q.k === k);
    const row = x ? rowOfLength(x.L) : null;
    return row === null ? `<span class="chip off"${tip('엔진이 이 극소를 내지 않았다')}>${name}</span>` : `<span class="chip${row === i && m === 1 ? ' on' : ''}" data-pick="len:${row}">${name}</span>`;
  };
  // 3D(칩) — 제품의 렌더러를 이 자리에 붙인다(v3d.ts). 2D 가 기본
  const body = opts.mode3d ? `<div class="v3d" data-v3d data-len="${i}" data-mode="${m}"></div>` : svg;
  return `<div class="dv" data-draw="mode"${opts.mode3d ? '' : ' data-zoom="mode"'} data-len="${i}" data-mode="${m}">${body}`
    + `<div class="hud tl">${first ? vsel(views) : ''}<span class="chip mode on"${tip('고른 반파장의 모드 형상 — 곡선을 누르면 그 반파장으로')}>${sel ? (sel.k === 'local' ? '국부' : sel.k === 'dist' ? '뒤틀림' : sel.k === 'global' ? '전체' : '극소') : `모드 ${m}`} · ${esc(sigText(L ?? 0, 4))} mm</span>`
    + `${narrow && w >= 440 ? kchip('dist', '뒤틀림') + kchip('local', '국부') + kchip('global', '전체') : ''}${narrow ? '' : chip('stress', '응력', '기준 응력 분포(절점 응력)') + chip('modeNodes', '절점')}</div>`
    + `<div class="hud tr">${chip('mode3d', '3D', '3D 모드 형상(제품의 렌더러 — 끌어 돌리기 · 휠 확대). 끄면 2D')}${opts.mode3d || narrow ? '' : fitBtn('mode')}</div>`
    + (narrow || opts.mode3d ? '' : `<div class="hud bl"><div class="thumbs3">${thumb('local', '국부')}${thumb('dist', '뒤틀림')}${thumb('global', '전체')}</div></div>`)
    + `<div class="hud br"><span class="cap">변형 배율 임의 · 회색 = 변형 전 · LF ${num(an.curve[i][m], { src: `curve:${i}.${m}`, kind: 'none', unit: false, sig: 4 })}</span></div></div>`;
}

function curveView(w: number, h: number, first: boolean, views: V[]): string {
  const a = analysisState();
  if (!a.ok) { return honest(a.title, a.why); }
  const an = state.analysis!;
  const f = dsmFam();
  const fam = f?.fam ?? '';
  const cls = an.classes ? an.curve.map((_, i) => (Array.isArray(an.classes![i]?.[0]) ? an.classes![i][0] : null)) : null;
  const unsupported = an.classStatus && an.classStatus.supported === false;
  const note = unsupported ? (an.classStatus?.code === 'ROUNDED_CORNER' ? '둥근 모서리 단면 — cFSM 분류를 하지 않는다' : (an.classStatus?.message ?? '엔진이 분류를 내지 않았다')) : (!cls ? '분류를 돌리지 않았다' : null);
  const svg = curveSvg({ w, h, rows: an.curve, marks: marks(), sel: modeSel.len, selMode: modeSel.mode, higher: opts.higher, classes: unsupported ? null : cls, classNote: note,
    yLabel: fam === 'P' ? 'LF = Pcr / Py' : fam ? `LF = ${fam}cr / My` : 'LF' });
  const famChip = ['P', 'Mxx', 'Mzz'].map(k => `<span class="${k === fam ? 'on' : 'off'}"${tip(k === fam ? `지금 해석의 하중 계열 — ${FAMILY_KO[k]}` : '이 하중 계열의 해석은 없다(해석은 한 번에 한 계열)')}>${k === 'P' ? 'P' : k === 'Mxx' ? 'M' : 'Mz'}</span>`).join('');
  return `<div class="dv" data-draw="curve" data-zoom="curve">${svg}`
    + `<div class="hud tl">${first ? vsel(views) : ''}${chip('higher', '고차 모드', `모드 2 – ${Math.max(...an.curve.map(r => r.length - 1))}`)}</div>`
    + `<div class="hud tr"><span class="vsel">${famChip}</span>${fitBtn('curve')}</div>`
    + (note ? `<div class="hud bl"><span class="cap" data-cls="none"${tip(an.classStatus?.message ?? '')}>분류 없음 — ${esc(note)}</span></div>` : '<div class="hud bl"><span class="cap" data-cls="bands">아래 띠 = 모드 1 의 cFSM 분류 G · D · L · O</span></div>')
    + '</div>';
}

// ── 부재 · 판정비 띠 ─────────────────────────────────────────────────
function regionsList(): Region[] {
  return state.regions.map(r => ({ a: Number(r.si?.start_ft), b: Number(r.si?.end_ft), ratio: typeof r.si?.result?.utilization === 'number' ? r.si.result.utilization : null,
    pass: r.us?.result?.pass === true ? true : r.us?.result?.pass === false ? false : null, run: r.runKey, label: String(r.us?.label ?? r.us?.id ?? ''),
    lane: (String(r.us?.kind ?? '').startsWith('uplift') ? 1 : 0) as 0 | 1 }))
    .filter(r => Number.isFinite(r.a) && Number.isFinite(r.b));
}

/** 퍼린 구간의 검토 지점 막대 — 엔진의 location.x 와 그 지점의 utilization · pass */
function pointBars(): PointBar[] {
  const out: PointBar[] = [];
  for (const r of state.regions) {
    const run = state.runs.find(x => x.key === r.runKey);
    if (!run) { continue; }
    const lane = (String(r.us?.kind ?? '').startsWith('uplift') ? 1 : 0) as 0 | 1;
    for (const p of run.points) {
      if (p.xm === null) { continue; }
      const first = run.rows.find(x => x.point === p.index && x.pass === false) ?? run.rows.find(x => x.point === p.index);
      out.push({ x: p.xm, ratio: p.ratio, pass: p.pass, lane, run: run.key, p: p.index, key: first?.key ?? run.key, src: p.src });
    }
  }
  return out;
}

function selRegion(key: string): { a: number; b: number; label: string } | null {
  const run = key.includes('#') ? key.split('#')[0] : null;
  const rg = state.regions.find(r => r.runKey === run);
  if (!rg) { return null; }
  return { a: Number(rg.si?.start_ft), b: Number(rg.si?.end_ft), label: `검토 구간 · ${regionLabel(rg.us, rg.si, state.regions.indexOf(rg))}` };
}

function memberView(w: number, h: number, key: string, first: boolean, views: V[], withBand: boolean): string {
  const st = state.stages.load;
  if (!state.loads) {
    const how = 'Claude 에게 말로(analyze_loads · design_purlin), 또는 편집 상태의 「하중 분석 실행」';
    const why = st.state === 'stale' ? `${st.note} — ${how}` : `하중 해석이 화면에 없다 — ${how}`;
    return honest(st.state === 'stale' ? '낡음 — 결과를 지웠다' : '하중 해석 결과 없음', why);
  }
  const rows: Row[] = ['beam'];
  if (withBand) { rows.push('band'); }
  if (opts.M) { rows.push('M'); }
  if (opts.V && !withBand) { rows.push('V'); }
  if (opts.D && !withBand) { rows.push('D'); }
  const { row } = rowOfKey(key);
  const loc = row && row.xm !== null ? { x: row.xm, label: `검토 위치 x = ${tnumX(row.si?.location?.x?.value, 3, { src: `${row.src}location.x.value`, kind: 'length', sig: 3 })} m` } : null;
  const sr = selRegion(key);
  // 검토 위치가 있으면 구간 이름표 대신 위치 표지(둘이 겹치지 않게) — 구간 강조는 그대로
  const m = memberSvg({ w, la: state.loads.si, rows, regions: withBand ? regionsList() : [], sel: sr && loc ? { ...sr, label: '' } : sr, points: withBand ? pointBars() : [], loc });
  return `<div class="dv" data-draw="member" data-zoom="member">${m.svg}`
    + `<div class="hud tl">${first ? vsel(views) : ''}${chip('M', 'M')}${withBand ? '' : chip('V', 'V') + chip('D', '처짐')}</div>`
    + `<div class="hud tr"><span class="chip on"${tip('엔진의 지배 조합')}>${esc(String(state.loads.us.governing?.combo ?? '조합'))}</span>${fitBtn('member')}</div>`
    + `<div class="hud bl">${withBand ? '<div class="legend" data-tip="구간마다 엔진의 판정비. 빗금은 미검토이고 합격이 아니다"><i style="background:var(--r1)"></i><span>&lt;0.50</span><i style="background:var(--r2)"></i><span>0.75</span><i style="background:var(--r3)"></i><span>0.90</span><i style="background:var(--r4)"></i><span>1.00</span><i style="background:var(--r5)"></i><span>1.25</span><i style="background:var(--r6)"></i><span>NG</span><i class="un"></i><span>미검토</span></div>'
      : '<span class="legend2"><span><i></i>랩 끝</span><span><i class="ip"></i>변곡점</span></span>'}</div></div>`;
}

// ── 판정비 표(U1) ─────────────────────────────────────────────────
function checkRow(r: CheckRow, sel: string): string {
  const v = verdictOf(r.pass);
  const ng = r.pass === false;
  const bar = r.kind === 'ls' && typeof r.ratio === 'number'
    ? `<div class="ratio"><div class="track"><div class="fill" style="width:${Math.min(100, r.ratio * 100).toFixed(1)}%;background:${bandVar(r.ratio, ng)}"></div></div>${checkRatioHtml(r.us, r.ratio, ng, `${r.src}ratio`, true)}</div>`
    : `<div class="ratio"><div class="track un"></div><span class="faint">${r.kind === 'na' ? '해당 없음' : r.kind === 'ls' ? '비 없음' : esc(unText(r))}</span></div>`;
  const vt = r.kind === 'ne' ? '미검토' : r.kind === 'na' ? '해당 없음' : v.text;
  return `<tr class="ck${r.key === sel ? ' on' : ''}${r.kind === 'na' ? ' na' : ''}" data-k="${esc(r.key)}" data-id="${esc(r.id)}" data-verdict="${r.kind === 'ne' ? 'ne' : r.kind === 'na' ? 'na' : v.cls}"><td><span class="dot ${r.kind === 'na' ? '' : v.cls}"></span></td><td>${esc(r.where)}</td>`
    + `<td>${esc(r.name)}${r.clause ? ` <span class="faint">§${esc(r.clause)}</span>` : ''}</td><td class="r dc">${demandCapacity(r)}</td><td>${bar}</td>`
    + `<td class="r verdict ${r.kind === 'na' ? 'un' : v.cls}">${vt}</td></tr>`;
}

function verdictView(sel: string, first: boolean, views: V[]): string {
  const s = state.stages.chk;
  if (s.state !== 'ok') { return honest(s.state === 'stale' ? '낡음 — 결과를 지웠다' : '아직 평가 안 함', s.note); }
  const rows: string[] = [];
  for (const run of memberRuns()) {
    if (!run.rows.length && !run.notChecked.length) { continue; }
    const ov = verdictOf(run.overall, '판정 없음');
    rows.push(`<tr class="grp"><td colspan="6">${esc(run.label)} · 전체 <span class="verdict ${ov.cls}">${ov.text}</span>${run.governing ? ` · 지배 ${esc(run.governing)}` : ''}</td></tr>`);
    for (const r of run.rows) { rows.push(checkRow(r, sel)); }
    for (const t of run.notApplicable) { rows.push(`<tr class="na"><td><span class="dot"></span></td><td>${esc(run.where)}</td><td>${esc(t)}</td><td></td><td></td><td class="r faint">해당 없음</td></tr>`); }
    for (const t of run.notChecked) { rows.push(`<tr class="out"${t.code ? ` data-code="${esc(t.code)}"` : ''}><td><span class="dot"></span></td><td>${esc(run.where)}</td><td class="faint">${esc(t.text)}</td><td></td><td></td><td class="r faint"${tip('엔진이 이 검토의 범위 밖으로 둔 것 — 판정에 들어가지 않는다')}>범위 밖</td></tr>`); }
  }
  return `<div class="dv vt-wrap"><div class="vt-head">${first ? vsel(views) : ''}<b>판정비</b><span class="faint"${tip('엔진의 design_checks(검토 항목) · not_checked 를 그 차례대로. 판정 차례: NG > 미검토 > OK. 해당 없음은 판정을 끌어내리지 않는다')}>위치 · 한계상태 · 소요 / 설계강도 · 엔진 판정</span><span class="sp"></span>`
    + `<div class="legend"${tip('판정비 구간색. 미검토는 합격이 아니다')}><i style="background:var(--r1)"></i><span>&lt;0.50</span><i style="background:var(--r2)"></i><span>0.75</span><i style="background:var(--r3)"></i><span>0.90</span><i style="background:var(--r4)"></i><span>1.00</span><i style="background:var(--r5)"></i><span>1.25</span><i style="background:var(--r6)"></i><span>NG</span><i class="un"></i><span>미검토</span></div></div>`
    + `<table class="t vt" data-table="checks"><thead><tr><th></th><th>위치</th><th>한계상태</th><th class="r">소요 / 설계강도</th><th>판정비</th><th class="r">판정</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

// ── 접합 ───────────────────────────────────────────────────────────
function lapView(w: number, h: number, first: boolean, views: V[]): string {
  const st = state.stages.conn;
  if (!state.lap && !state.conn) { return honest(st.state === 'stale' ? '낡음 — 결과를 지웠다' : '접합부 검토 결과 없음', st.state === 'stale' ? st.note : 'Claude 에게 말로, 또는 편집 상태의 접합부 탭'); }
  const svg = state.lap ? lapSvg({ w, h, lap: state.lap, nodes: state.nodes, elems: state.elems, dims: opts.dims, force: opts.force }) : connSvg(w, h, state.conn!);
  return `<div class="dv" data-draw="lap" data-zoom="lap">${svg}`
    + `<div class="hud tl">${first ? vsel(views) : ''}${chip('dims', '치수')}${state.lap ? chip('force', '힘', '랩 끝 패스너의 짝힘 — 자체 가정의 힘 분배(force_model)') : ''}</div>`
    + `<div class="hud tr"><span class="chip on">${state.lap ? '랩 접합' : '단일 접합'}</span>${fitBtn('lap')}</div></div>`;
}

// ── 표 서랍 ───────────────────────────────────────────────────────
const n4 = (v: unknown, src: string, kind: Parameters<typeof num>[1]['kind'], sig = 4) => num(typeof v === 'number' ? v : null, { src, kind, unit: false, sig });
const sv = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : '');

function modelDrawer(): string {
  const nodes = state.nodes.map((n, i) => `<tr><td>${esc(n[0])}</td><td class="r">${num(si(n[1], 'length'), { src: `nodes:${i}.1`, kind: 'length', unit: false })}</td>`
    + `<td class="r">${num(si(n[2], 'length'), { src: `nodes:${i}.2`, kind: 'length', unit: false })}</td><td class="r">${num(si(n[7], 'stress'), { src: `nodes:${i}.7`, kind: 'stress', unit: false })}</td></tr>`).join('');
  // 요소의 자리 — get_full_state 의 element_roles(템플릿 단면만, 요소 차례대로). 손으로 만든 단면은 짐작하지 않는다
  const roles: unknown[] | null = Array.isArray(state.full?.element_roles) && state.full.element_roles.length === state.elems.length ? state.full.element_roles : null;
  const elems = state.elems.map((e, i) => `<tr><td>${esc(e[0])}</td><td class="r">${esc(e[1])}</td><td class="r">${esc(e[2])}</td>`
    + `<td class="r">${num(si(e[3], 'length'), { src: `elems:${i}.3`, kind: 'length', unit: false })}</td><td class="r">${esc(e[4])}</td>`
    + `<td data-role="${roles ? esc(String(roles[i])) : ''}">${roles ? esc(ROLE_KO[String(roles[i])] ?? String(roles[i])) : '<span class="faint">—</span>'}</td></tr>`).join('');
  return '<div class="drawer">'
    + `<header><b>절점 · 요소</b><span class="chip on">절점 ${state.nodes.length}</span><span class="chip on">요소 ${state.elems.length}</span>`
    + `<span class="chip">스프링 ${esc(state.full?.nsprings ?? '—')}</span><span class="chip">구속 ${esc(state.full?.nconstraints ?? '—')}</span><span class="sp"></span>`
    + `<span class="faint"${tip('MCP get_nodes · get_elements 와 같은 값을 mm · MPa 로')}>mm · MPa · 절점 좌표계</span></header>`
    + '<div class="dtabs">'
    + `<div><table class="t" data-table="nodes"><thead><tr><th>절점</th><th class="r">x</th><th class="r">z</th><th class="r"${tip('기준 응력 분포(절점 응력)')}>σ MPa</th></tr></thead><tbody>${nodes}</tbody></table></div>`
    + `<div><table class="t" data-table="elems"><thead><tr><th>요소</th><th class="r">i</th><th class="r">j</th><th class="r">t mm</th><th class="r">재료</th><th${tip(roles ? '요소의 자리(엔진의 element_roles)' : '템플릿 단면이 아니라 자리가 없다 — 짐작하지 않는다')}>자리</th></tr></thead><tbody>${elems}</tbody></table></div>`
    + '</div></div>';
}

export function tablesFor(group: Group): DTable[] {
  if (group === 'fsm' || group === 'chk') {
    const t: DTable[] = [];
    if (group === 'chk') {
      const rows = memberRuns().flatMap((run: Run) => run.rows.map(r => {
        const v = verdictOf(r.pass);
        const vt = r.kind === 'ne' ? '미검토' : r.kind === 'na' ? '해당 없음' : v.text;
        return { key: r.key, cells: [esc(r.where), esc(r.name), esc(r.clause), demandCapacity(r), typeof r.ratio === 'number' ? checkRatioHtml(r.us, r.ratio, r.pass === false, `${r.src}ratio`, true) : '<span class="faint">—</span>', `<span class="verdict ${r.kind === 'na' ? 'un' : v.cls}">${vt}</span>`, `<span class="faint">${esc(r.id)}</span>`],
          sort: [r.where, r.name, r.clause, typeof r.si?.capacity?.value === 'number' ? r.si.capacity.value : -1, r.ratio ?? -1, vt, r.id], tsv: [r.where, r.name, r.clause, String(r.si?.demand?.value ?? ''), String(r.si?.capacity?.value ?? ''), String(r.ratio ?? ''), vt, r.id] };
      }));
      t.push({ id: 'checks', title: '판정비', cols: [{ t: '위치' }, { t: '한계상태' }, { t: '조항' }, { t: '소요 / 설계강도', num: true }, { t: '판정비', num: true }, { t: '판정' }, { t: 'id' }], rows, empty: '부재 검토 결과 없음' });
      const rg = state.regions.map((r, i) => {
        const res = r.si?.result ?? {};
        const v = verdictOf(r.us?.result?.pass, '판정 없음');
        const run = state.runs.find(x => x.key === r.runKey);
        const k0 = (run?.rows.find(x => x.pass === false) ?? run?.rows[0])?.key ?? r.runKey;
        const secCell = psecOn() ? [`<span data-region-tag>${esc(regionSecTag(r.us) || '—')}</span>`] : [];
        return { key: k0, cells: [esc(fieldText(r.us, 'label')), ...secCell, n4(r.si?.start_ft, `purlin:regions.${i}.start_ft`, 'length_ft', 4), n4(r.si?.end_ft, `purlin:regions.${i}.end_ft`, 'length_ft', 4),
          n4(r.si?.Mu, `purlin:regions.${i}.Mu`, 'moment', 4), utilHtml(r.us?.result, res.utilization, `purlin:regions.${i}.result.utilization`, none()), `<span class="verdict ${v.cls}">${v.text}</span>`, esc(String(pageOf(r.us?.result)?.governing_check ?? ''))],
          sort: [fieldText(r.us, 'label'), ...(psecOn() ? [regionSecTag(r.us)] : []), sv(r.si?.start_ft), sv(r.si?.end_ft), sv(r.si?.Mu), sv(res.utilization), v.text, String(r.us?.result?.governing_check ?? '')],
          tsv: [fieldText(r.us, 'label'), ...(psecOn() ? [regionSecTag(r.us)] : []), String(sv(r.si?.start_ft)), String(sv(r.si?.end_ft)), String(sv(r.si?.Mu)), String(sv(res.utilization)), v.text, String(r.us?.result?.governing_check ?? '')] };
      });
      if (rg.length) { t.push({ id: 'regions', title: '구간', cols: [{ t: '구간' }, ...(psecOn() ? [{ t: '단면' }] : []), { t: '시작 m', num: true }, { t: '끝 m', num: true }, { t: 'Mu kN·m', num: true }, { t: '판정비', num: true }, { t: '판정' }, { t: '지배' }], rows: rg }); }
    }
    const an = state.analysis;
    if (an) {
      const nm = Math.min(10, Math.max(...an.curve.map(r => r.length - 1)));
      t.push({ id: 'curve', title: '곡선 점', note: '반파장 mm · 하중계수(엔진의 곡선 그대로)',
        cols: [{ t: '#', num: true }, { t: '반파장', num: true }, ...Array.from({ length: nm }, (_, k) => ({ t: `모드 ${k + 1}`, num: true }))],
        rows: an.curve.map((r, i) => ({ key: `len:${i}`, cells: [String(i + 1), num(si(r[0], 'length'), { src: `curve:${i}.0`, kind: 'length', unit: false }), ...Array.from({ length: nm }, (_, k) => n4(r[k + 1], `curve:${i}.${k + 1}`, 'none', 4))],
          sort: [i, r[0], ...Array.from({ length: nm }, (_, k) => sv(r[k + 1]))], tsv: [String(i + 1), String(si(r[0], 'length')), ...Array.from({ length: nm }, (_, k) => String(sv(r[k + 1])))] })) });
      const f = dsmFam();
      const mins = Array.isArray(f?.d?.minima) ? f!.d.minima : [];
      t.push({ id: 'minima', title: '극소', note: '엔진(get_dsm_values)이 찾은 극소 그대로',
        cols: [{ t: '#', num: true }, { t: '반파장 mm', num: true }, { t: 'LF', num: true }, { t: '분류' }],
        rows: mins.map((m: any, i: number) => ({ cells: [String(i + 1), n4(m.length, `dsm:${f!.fam}.minima.${i}.length`, 'length'), n4(m.load_factor, `dsm:${f!.fam}.minima.${i}.load_factor`, 'none'), esc(String(m.mode_class ?? m.label_status ?? ''))],
          sort: [i, sv(m.length), sv(m.load_factor), String(m.mode_class ?? '')], tsv: [String(i + 1), String(sv(m.length)), String(sv(m.load_factor)), String(m.mode_class ?? '')] })), empty: '극소 없음' });
    }
    return t;
  }
  if (group === 'load') {
    const la = state.loads?.si;
    if (!la) { return []; }
    const g = la.governing ?? {};
    const locs = Array.isArray(g.locations) ? g.locations : [];
    const xs: number[] = Array.isArray(g.x_diagram) ? g.x_diagram : [];
    const M: number[] = g.M_diagram ?? [], Vv: number[] = g.V_diagram ?? [], D: number[] = la.deflection?.D_diagram ?? [];
    const R: number[] = g.R_envelope_max ?? [], Rn: number[] = g.R_envelope_min ?? [];
    const sup: number[] = la.auto_params?.unbraced?.supports_ft ?? [];
    return [
      { id: 'locations', title: `위치별 소요강도 — ${String(g.combo ?? '')}`, note: 'kN · kN·m · m — 엔진이 이름 붙인 위치', cols: [{ t: '위치' }, { t: 'x m', num: true }, { t: 'Mu', num: true }, { t: 'Vu', num: true }, { t: 'Ru', num: true }, { t: '구간' }],
        rows: locs.map((l: any, i: number) => ({ cells: [esc(String(l.name ?? '')), n4(l.x_ft, `loads:governing.locations.${i}.x_ft`, 'length_ft'), n4(l.Mu, `loads:governing.locations.${i}.Mu`, 'moment_ft'), n4(l.Vu, `loads:governing.locations.${i}.Vu`, 'force'),
          typeof l.Ru === 'number' ? n4(l.Ru, `loads:governing.locations.${i}.Ru`, 'force') : '<span class="faint">—</span>', esc(String(l.region ?? ''))],
          sort: [String(l.name ?? ''), sv(l.x_ft), sv(l.Mu), sv(l.Vu), sv(l.Ru), String(l.region ?? '')], tsv: [String(l.name ?? ''), String(sv(l.x_ft)), String(sv(l.Mu)), String(sv(l.Vu)), String(sv(l.Ru)), String(l.region ?? '')] })) },
      { id: 'stations', title: '도표 점', note: '엔진의 도표 점 그대로(처짐은 사용하중)', cols: [{ t: '#', num: true }, { t: 'x m', num: true }, { t: 'M kN·m', num: true }, { t: 'V kN', num: true }, { t: 'δ mm', num: true }],
        rows: xs.map((x, i) => ({ cells: [String(i + 1), n4(x, `loads:governing.x_diagram.${i}`, 'length_ft'), n4(M[i], `loads:governing.M_diagram.${i}`, 'moment_ft'), n4(Vv[i], `loads:governing.V_diagram.${i}`, 'force'), n4(D[i], `loads:deflection.D_diagram.${i}`, 'length')],
          sort: [i, x, sv(M[i]), sv(Vv[i]), sv(D[i])], tsv: [String(i + 1), String(x), String(sv(M[i])), String(sv(Vv[i])), String(sv(D[i]))] })) },
      { id: 'reactions', title: '지점 반력', note: '포락 최대 · 최소 kN', cols: [{ t: '지점' }, { t: 'x m', num: true }, { t: 'R 최대', num: true }, { t: 'R 최소', num: true }],
        rows: R.map((r, i) => ({ cells: [String.fromCharCode(65 + i), n4(sup[i], `loads:auto_params.unbraced.supports_ft.${i}`, 'length_ft'), n4(r, `loads:governing.R_envelope_max.${i}`, 'force'), n4(Rn[i], `loads:governing.R_envelope_min.${i}`, 'force')],
          sort: [i, sv(sup[i]), r, sv(Rn[i])], tsv: [String.fromCharCode(65 + i), String(sv(sup[i])), String(r), String(sv(Rn[i]))] })) },
    ];
  }
  if (group === 'conn') {
    const out: DTable[] = [];
    if (state.lap) {
      const s = state.lap.si;
      out.push({ id: 'fasteners', title: '패스너', note: '지점 중심에서 mm · 배치 규칙은 웹뷰의 랩 도면과 같다(열 높이는 개략)', cols: [{ t: '#', num: true }, { t: 'x mm', num: true }, { t: '열', num: true }],
        rows: lapFasteners(s).map((f, i) => ({ cells: [String(i + 1), sigText(f.x, 4), String(f.row + 1)], sort: [i, f.x, f.row], tsv: [String(i + 1), String(f.x), String(f.row + 1)] })) });
      const steps = Array.isArray(s.steps) ? s.steps : [];
      out.push({ id: 'steps', title: '계산 단계', note: '엔진의 단계 — 식의 글은 US 그대로', cols: [{ t: '단계' }, { t: '이름' }, { t: '값', num: true }, { t: '단위' }],
        rows: steps.map((st: any, i: number) => ({ cells: [esc(String(st.step)), esc(String(st.name ?? '')), n4(st.value, `lap:steps.${i}.value`, 'none'), esc(String(st.unit ?? ''))],
          sort: [i, String(st.name ?? ''), sv(st.value), String(st.unit ?? '')], tsv: [String(st.step), String(st.name ?? ''), String(sv(st.value)), String(st.unit ?? '')] })) });
    }
    const ls = state.lap ? (state.lap.si.fastener_design?.limit_states ?? []) : (state.conn?.si.limit_states ?? []);
    const pre = state.lap ? 'lap:fastener_design.limit_states' : 'conn:limit_states';
    out.push({ id: 'limits', title: '한계상태 · 패스너', note: 'kN · 엔진의 Rn · φ · 설계강도', cols: [{ t: '한계상태' }, { t: 'Rn', num: true }, { t: 'φ', num: true }, { t: '설계강도', num: true }, { t: '방향' }],
      rows: ls.map((l: any, i: number) => ({ cells: [esc(fieldText(l, 'name')), n4(l.Rn, `${pre}.${i}.Rn`, 'force'), n4(l.phi, `${pre}.${i}.phi`, 'none', 3), n4(l.design_strength, `${pre}.${i}.design_strength`, 'force'), esc(String(l.direction ?? ''))],
        sort: [String(l.name ?? ''), sv(l.Rn), sv(l.phi), sv(l.design_strength), String(l.direction ?? '')], tsv: [String(l.name ?? ''), String(sv(l.Rn)), String(sv(l.phi)), String(sv(l.design_strength)), String(l.direction ?? '')] })), empty: '한계상태 없음' });
    return out;
  }
  return [];
}

/** 업무 항목의 첫 걸린 대상 → 화면의 키(검토 · 결과 · 칸) */
function workTarget(id: string): string | { gone: any } | null {
  const f = work.full.get(id);
  const refs: any[] = Array.isArray(f?.item?.refs) ? f.item.refs : [];
  const resolved: any[] = Array.isArray(f?.item?.refs_resolved) ? f.item.refs_resolved : [];
  for (const [i, r] of refs.entries()) {
    // 호스트가 푼 상태(refs_resolved) — 지금 없는 검토 · 결과는 단계로 떨어지지 않고 그 이름과 까닭을 그대로 보인다
    const rs = resolved[i];
    if (rs && (r?.kind === 'check' || r?.kind === 'result') && rs.state && rs.state !== 'current') { return { gone: rs }; }
    if (r?.kind === 'check' && r.check) { const k = keyOfItem({ kind: 'check', id: String(r.check.id), scope: r.check.scope, ...(r.check.location ? { location: r.check.location } : {}) } as never); if (k) { return k.key; } }
    if (r?.kind === 'result' && r.result) {
      const k = keyOfItem({ kind: 'result', id: String(r.result) } as never);
      if (k) { return k.key; }
      // 지금 있는 결과(호스트가 푼 상태 current)인데 고를 줄이 없으면 그 결과의 단계
      const st: Record<string, string> = { lap: 'conn', connection: 'conn', member_design: 'chk', buckling_analysis: 'fsm', signature_ss: 'fsm', load_analysis: 'load' };
      if (rs?.state === 'current' && st[String(r.result)]) { return st[String(r.result)]; }
    }
    const k = refKey(r);
    if (k && k.tab !== 'work') { return k.key; }
  }
  return null;
}

// ── 업무 › 변경(R2-3 · 템플릿 07) ───────────────────────────────────
/** 결과 종류의 지금 상태(진행 띠와 같은 것) */
const STAGE_OF: Record<string, keyof typeof state.stages> = { buckling_analysis: 'fsm', design_dsm: 'fsm', load_analysis: 'load', member_design: 'chk', lap: 'conn', connection: 'conn', validation: 'val' };
const STAGE_KO: Record<string, string> = { ok: '일치', stale: '낡음', none: '없음', run: '다시 실행 중', unk: '모름' };
export function stageNow(kind: string): { t: string; cls: string } {
  const st = state.stages[STAGE_OF[kind]]?.state ?? 'unk';
  return { t: STAGE_KO[st] ?? st, cls: st === 'stale' ? 'verdict warn' : st === 'run' ? 'acc' : st === 'ok' ? 'dim' : 'faint' };
}

/**
 * 가운데 — 단면(지금 모델) · 칩(바뀐 칸 · 낡게 한 결과) · 「비교 기준 ▾」 · 표 서랍 「바뀐 값 <기준> → 지금」 + 「따라 바뀐 것」.
 * 줄 · 글은 호스트의 것(list_changes 의 칸 글 — 프로그램이 지은 「이름 전 → 후 단위」). 화면은 기준 뒤의 묶음을 고르기만 한다
 */
function changeView(key: string, size: { w: number; h: number }): { html: string; cls: string } {
  const c: Change | undefined = key.startsWith('chg:') ? changeOf(key.slice(4)) : chg.list[0];
  if (!c) {
    return { html: honest(chg.err ? '변경을 읽지 못함' : '변경 없음', chg.err ?? '이 대상에 기록된 변경 묶음이 없다 — AI 의 도구 하나 · 편집 상태 한 번 · 화면의 고침(조용한 2 초)이 묶음 하나가 된다'), cls: 'v1' };
  }
  const b = baseOf(c);
  const since = sinceBase(c);
  const W = Math.max(420, Math.round(size.w));
  const H = Math.max(320, size.h - 300);
  // 고른 변경이 건드린 요소(호스트의 geometry.element_ids — 요소 번호): 바뀜은 주황, 더함은 초록. 뺀 요소는 지금 모델에 없다(수만 칩에)
  const g = c.geometry ?? null;
  const eids = g?.element_ids ?? { changed: [], added: [], removed: [] };
  const svg = sectionSvg({ w: W, h: H, nodes: state.nodes, elems: state.elems, props: state.props, shear: state.cutwp, extent: state.full?.section ?? null, template: tplOf(),
    labels: false, elemLabels: false, dims: true, axes: false, stress: false, modElems: eids.changed ?? [], addElems: eids.added ?? [] });
  const inv = [...new Set(since.flatMap(x => x.invalidated ?? []))];
  // 칩 「바뀜 · 추가 · 삭제」 — 요소(절점 · 요소가 바뀐 변경이면 호스트의 geometry), 아니면 바뀐 칸 수(호스트의 fields)
  const el = g?.elements ?? null;
  const nMod = el ? el.changed : c.fields, nAdd = el ? el.added : 0, nDel = el ? el.removed : 0;
  const what = el ? '요소' : '칸';
  const view = `<div class="dv" data-draw="section" data-zoom="section" data-chg-view="${esc(c.id)}">${svg}`
    // D1(800 px): 칩(왼쪽 묶음)과 「비교 기준 ▾ · 전체 맞춤」(오른쪽 묶음)을 한 줄 틀(hud top2)에 — 좁으면 묶음이 줄을 바꿔 겹치지 않는다
    + `<div class="hud top2" data-chg-hud><div class="grp l" data-chg-chips><span class="chip" data-chg-mod="${nMod}"${tip(`이 변경이 바꾼 ${what}(호스트 ${el ? 'geometry' : 'fields'})${g?.explained_by_dimensions ? ' — 템플릿 치수의 변경으로 다시 만든 절점 · 요소' : ''}`)}><i class="key" style="background:var(--mod)"></i>바뀜 ${nMod}</span>`
    + `<span class="chip" data-chg-add="${nAdd}"><i class="key" style="background:var(--add)"></i>추가 ${nAdd}</span>`
    + `<span class="chip" data-chg-del="${nDel}"><i class="key" style="background:var(--del)"></i>삭제 ${nDel}</span>`
    + (inv.length ? `<span class="chip"${tip('기준 뒤의 묶음들이 무효로 만든 결과(호스트의 장부)')}><i class="key" style="background:var(--warn)"></i>낡게 한 결과 ${inv.length}</span>` : '') + '</div>'
    + `<div class="grp r" data-chg-right><span class="chip" data-chg-base="${esc(c.id)}"${tip('비교 기준 — 이 때 뒤의 묶음을 지금까지 모아 서랍에 보인다(앞 변경을 고른다)')}>비교 기준 · ${b ? esc(hhmm(b.at)) : '처음'} ▾</span>${fitBtn('section')}</div></div>`
    + `<div class="hud bl"><span class="cap">지금 모델 · 절점 ${state.nodes.length} · 요소 ${state.elems.length}${el ? ` · 색 = 이 변경이 건드린 요소` : ''}</span></div></div>`;
  const rows: DTable['rows'] = [];
  const AREA: Record<string, string> = { sectionParams: '단면', sectionTemplate: '단면', node: '단면', elem: '단면', prop: '재료', inputs: '입력', spans: '경간', mcpOnly: 'MCP 인자' };
  // 2026-11-28 결정 S1: case.sections[S2]… 는 「단면 목록」
  const areaOf = (path: string) => (/^case\.sections\[/.test(path) ? '단면 목록' : AREA[path.split('.')[1] ?? ''] ?? (path.startsWith('case.') ? '입력' : '모델'));
  for (const x of since) {
    const who = whoText(x);
    const fs = x.field_changes ?? [];
    for (const f of fs) {
      const sm = f.summary;
      const whole = wholeSection(f);
      const was = whole ? '' : sm ? `${sm.count.from}개` : 'from' in f || 'to' in f ? `${valText(f.from)}${f.unit && typeof f.from === 'number' ? ` ${f.unit}` : ''}` : '';
      const now = whole ? f.text : sm ? `${sm.count.to}개 · 바뀜 ${sm.changed}${sm.added ? ` · 더함 ${sm.added}` : ''}${sm.removed ? ` · 뺌 ${sm.removed}` : ''}` : 'from' in f || 'to' in f ? `${valText(f.to)}${f.unit && typeof f.to === 'number' ? ` ${f.unit}` : ''}` : f.text;
      rows.push({ key: `chg:${x.id}`, cells: [`${esc(hhmm(x.at))} <span class="faint" data-by="${esc(x.by.kind)}">${esc(who)}</span>`, esc(areaOf(f.path)), `<span data-path="${esc(f.path)}">${esc(f.label_ko || f.key)}</span>`,
        `<span class="dim">${esc(was)}</span>`, `<span style="color:var(--mod)">${esc(now)}</span>`],
      sort: [x.at, areaOf(f.path), f.label_ko || f.key, was, now], tsv: [`${hhmm(x.at)} ${who}`, areaOf(f.path), f.label_ko || f.key, was, now] });
    }
    if (!fs.length) { rows.push({ key: `chg:${x.id}`, cells: [`${esc(hhmm(x.at))} ${esc(who)}`, '', esc(x.title), '', ''], sort: [x.at, '', x.title, '', ''], tsv: [hhmm(x.at), '', x.title, '', ''] }); }
    if (fs.length < x.fields) { rows.push({ key: `chg:${x.id}`, cls: 'faint', cells: ['', '', `외 ${x.fields - fs.length} 칸`, '', ''], sort: [x.at, '', '', '', ''], tsv: ['', '', '', '', ''] }); }
  }
  if (inv.length) {
    rows.push({ cls: 'grp', cells: ['', '', '<span data-tip="기준 뒤의 묶음들이 무효로 만든 결과 — 지금 상태는 진행 띠와 같다">따라 바뀐 것</span>', '', ''], sort: ['', '', '', '', ''], tsv: ['', '', '따라 바뀐 것', '', ''] });
    for (const k of inv) {
      const s2 = stageNow(k);
      rows.push({ cells: ['', '<span class="dim">결과</span>', `<span data-follow="${esc(k)}">${esc(KIND_RESULT_KO[k] ?? k)}</span>`, '<span class="dim">일치</span>', `<span class="${s2.cls}">${esc(s2.t)}</span>`],
        sort: ['', '', k, '', s2.t], tsv: ['', '결과', KIND_RESULT_KO[k] ?? k, '일치', s2.t] });
    }
  }
  const table: DTable = { id: 'chg', title: '바뀐 값', note: `${b ? hhmm(b.at) : '처음'} → 지금`,
    cols: [{ t: '때 · 누가' }, { t: '대상' }, { t: '항목' }, { t: '이전', num: true }, { t: '이후', num: true }], rows, empty: '바뀐 칸 없음' };
  return { html: view + drawerHtml([table], { sel: `chg:${c.id}`, collapsedDefault: false }), cls: 'v1 withdrawer' };
}

/** 그림 칸의 크기(px) — 그 비율로 viewBox 를 잡는다 */
export function centerHtml(key: string, size: { w: number; h: number } = { w: 1240, h: 900 }): { html: string; cls: string } {
  // 점검 · 문서(K3) — 표 · 미리보기 하나
  if (isValKey(key)) { return { html: valView(key), cls: 'v1 docc' }; }
  if (key === 'vtab') { return { html: vtabView(key), cls: 'v1 docc' }; }
  if (reportKindOf(key)) { return { html: reportView(key), cls: 'v1 docc' }; }
  if (key.startsWith('doc:') || key.startsWith('iss:')) { return { html: docView(key), cls: 'v1 docc' }; }
  if (key === 'dmg') { return { html: damageView(), cls: 'v1 docc' }; }
  // 2026-11-28 결정 S8: 고른 단면의 서명곡선(해석 탭의 좌굴 해석은 S1 — 섞지 않는다)
  if (key === 'psec' || key.startsWith('psec:')) { return { html: psecView(key, size), cls: 'v1' }; }
  if (key === 'pub' || key.startsWith('pubf:')) { return { html: honest('발행', '발행본을 고르면 읽기 전용으로 보인다 — 발행은 계산서의 정보 창 「R<n> 발행」(미리보기 → 사람만)'), cls: 'v1' }; }
  if (key === 'chg' || key.startsWith('chg:')) { return changeView(key, size); }
  // 기록의 묶는 줄(지난 계산 뒤 · 계산 #k · 그 앞) — 그 아래 첫 묶음의 보기
  if (key.startsWith('log:')) {
    const tl = timeline();
    const g = key.startsWith('log:run:') ? tl.groups.find(x => x.key === key) : undefined;
    const cs = key === 'log:after' ? tl.after : key === 'log:before' ? tl.before : g?.changes ?? [];
    return cs[0] ? changeView(`chg:${cs[0].id}`, size)
      : { html: g ? honest('입력 변경 없음', '앞 계산 뒤에 바뀐 입력이 없다 — 이 계산에 처음 들어간 묶음이 없다') : honest('묶음 없음', '이 자리에 바뀐 것이 없다'), cls: 'v1' };
  }
  // R3-3: 업무 항목 — 걸린 대상(첫째)의 보기를 그대로(정보 창이 그 항목). 가정 · 원자료는 글뿐이라 가운데는 비운다
  if (key.startsWith('work:')) {
    const t = workTarget(key.slice(5));
    if (t && typeof t === 'object') {
      const g = t.gone;
      return { html: `<div data-ref-gone="${esc(String(g.state))}">${honest(`${String(g.label_ko ?? '')} — ${g.state === 'invalidated' ? '무효가 됨' : '없음'}`,
        g.invalidated?.reason_ko ? `${String(g.invalidated.reason_ko)}${g.invalidated.at ? ` · ${hhmm(g.invalidated.at)}` : ''}` : '이 업무 항목이 가리키는 것이 지금 결과에 없다 — 다시 돌리면 생긴다')}</div>`, cls: 'v1' };
    }
    if (t && !t.startsWith('work:')) { return centerHtml(t, size); }
    return { html: honest('걸린 대상 없음', '이 업무 항목은 검토 · 결과 · 칸을 가리키지 않는다 — 정보 창에 글'), cls: 'v1' };
  }
  // R4-3: 대안 — 고른 대안(지금 | 그 대안) · 대안 가지(지금 | 모든 대안)를 검토 열쇠마다 나란히(호스트의 compare)
  if (key === 'alt' || key.startsWith('alt:')) {
    const list = key === 'alt' ? visibleAlts() : alts.items.filter(a => a.item === key.slice(4));
    if (!list.length) { return { html: honest('대안 없음', alts.err ?? '이 대상에 지킨 대안이 없다 — AI 가 alternatives keep 으로, 또는 정보 창의 「지금 것을 대안으로」'), cls: 'v1' }; }
    return { html: `<div class="dv docv" data-alt-view="${esc(key)}"><div class="hud tl"><span class="chip">대안 ${list.length}</span><span class="faint">열쇠마다 지금 | 대안 — 판정비 · 판정(호스트의 비교)</span></div>`
      + `<div class="doc-body" style="padding:48px 16px 16px;overflow:auto;height:100%">${sideBySide(list)}</div></div>`, cls: 'v1' };
  }
  if (key.startsWith('asmr:') || key.startsWith('srcr:') || key === 'asm:reg' || key === 'src:unreg') {
    return { html: honest(key.startsWith('src') ? '원자료' : '가정 등록부', key.startsWith('src') ? '내용은 프로그램이 읽지 않는다 — 정보 창의 「열기」가 OS 의 기본 앱으로 연다' : '가정의 글 · 상태 · 근거는 정보 창에'), cls: 'v1' };
  }
  const group = groupOf(key);
  syncModeFromKey(key);
  const views = viewsFor(key);
  const W = Math.max(420, Math.round(size.w));
  const tables = group === 'model' ? null : tablesFor(group);
  const drawerH = group === 'model' ? 300 : tables && tables.length ? (group === 'chk' ? 36 : 260) : 0;
  const avail = Math.max(320, size.h - drawerH);
  const one = (v: V, w: number, h: number, first: boolean): string => {
    switch (v) {
      case 'section': return sectionView(w, h, first, views);
      case 'mode': return modeView(w, h, first, views);
      case 'curve': return curveView(w, h, first, views);
      case 'member': return memberView(w, h, key, first, views, group === 'chk');
      case 'verdict': return verdictView(key, first, views);
      case 'lap': return lapView(w, h, first, views);
      default: return honest('문서 미리보기', '계산서 · 검증표는 K3 전까지 편집 상태의 보고서 · 검증 탭에서 만든다');
    }
  };
  let html: string;
  let cls: string;
  if (views.length >= 3) {
    const topH = Math.round(avail * 0.55), botH = avail - topH;
    html = one(views[0], W, topH, true) + `<div class="split">${one(views[1], Math.round(W * 0.44), botH, false)}${one(views[2], Math.round(W * 0.56), botH, false)}</div>`;
    cls = 'v2 s64';
  } else if (views.length === 2) {
    html = one(views[0], W, Math.round(avail * 0.5), true) + one(views[1], W, Math.round(avail * 0.5), false);
    cls = 'v2';
  } else {
    html = one(views[0], W, avail, true);
    cls = 'v1';
  }
  if (group === 'model') { html += modelDrawer(); }
  // 템플릿처럼 — 03 하중 해석만 표(위치별 소요강도)가 펼쳐져 있고 02 · 04 · 06 은 접혀 있다
  else if (tables && tables.length) { html += drawerHtml(tables, { sel: key, collapsedDefault: group !== 'load' }); }
  else { html += '<div></div>'; }
  return { html, cls: `${cls}${drawerH ? ' withdrawer' : ''}` };
}
