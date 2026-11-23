/**
 * 새 검토 화면 진입점 — 다리의 이벤트를 받아 상태를 다시 읽고, 트리 · 보기 · 정보 창(또는 계산 시트) · 진행 띠를 다시 그린다.
 *
 * 화면이 따라가는 것: 호스트가 설계 패널에 보내는 메시지(`host:message` — AI 의 MCP 호출이든 편집 상태의 단추든 같은 길)가
 * 오면 0.25 초 뒤 다시 읽는다. 보는 자리(탭 · 고른 줄)는 바꾸지 않는다(구성안 3.9) — 바꾸는 것은 사람과, 켜 둔 「AI 따라가기」뿐이다.
 * U3: 계산 시트(sheet.ts) · 우클릭 메뉴(ctxmenu.ts) · 찾기(find.ts) · 보기 보고와 AI 따라가기(follow.ts) · 3D 모드 형상(v3d.ts).
 */
import { api, connectEvents, mcp } from './bridge';
import { centerHtml, groupOf, modeSel, opts, setViews, tablesFor, viewsFor, type CenterOpts, type V } from './center';
import { menuAt, checkMenu, type MenuHandlers } from './ctxmenu';
import { copyText, openDrawer, setActiveTable, sortBy, toggleDrawer, tsvOf } from './drawer';
import { fitZoom, installZoom, restoreZoom } from './zoom';
import { answered, enqueue, initDialogs, questionOpen, setProgress, toast } from './dialogs';
import { debounce, esc, tip } from './dom';
import { editing, hideSide, initEdit, mountDesigner, reloadSide, setEditing, showSide, toggleEditing, onWebviewF2, postToWebviews, setEditTheme, setWebviewOrigin } from './edit';
import { beginEdit, editChanges, editStripHtml, endEdit } from './editstrip';
import { findHtml, search, type Hit } from './find';
import { clearPointed, following, handleFocus, idleFor, installIdle, itemOfKey, keyOfItem, lastFollowed, lastReported, onReport, pointedAt, report, setFollowing, takePointed, type FocusReq, type Item } from './follow';
import { hhmm } from './format';
import { infoHtml, shareLabel } from './info';
import { closeMenu, installMenuClosers, menuKey, menuOpen, openMenu, type MenuItem } from './menu';
import { neighbours, sheetHtml } from './sheet';
import { initStart, renderStart } from './start';
import { makeReport, refresh, rowOfKey, setRunning, setValRunning, state, type Stage } from './store';
import { bandHtml, KIND_KO, loadRecent, person, rec } from './records';
import { flashTip, installTips } from './tips';
import { claudeDone, claudeStatus, initTitlebar, renderClaude, renderFollow, renderTitle, type ClaudeStatus } from './titlebar';
import { buildTree, findNode, keysUnder, setTreeFilter, TABS, treeFilter, treeHtml, type Tab } from './tree';
import { UNITS_NOTE } from './units';
import { mount3d } from './v3d';

const params = new URLSearchParams(location.search);
const themeParam = params.get('theme');
let theme: 'dark' | 'light' = themeParam === 'light' ? 'light' : 'dark';
let themeFixed = themeParam === 'light' || themeParam === 'dark';
document.documentElement.setAttribute('data-theme', theme);

const ui = {
  screen: 'start' as 'start' | 'review',
  tab: 'model' as Tab,
  sel: { work: 'ask', model: 'sec', result: 'chk', doc: 'rpt' } as Record<Tab, string>,
  closed: new Set<string>(),
  opened: new Set<string>(),
  /** 계산 시트가 열려 있으면 그 검토 항목의 키 */
  sheet: null as string | null,
  /** 찾기 칸 */
  find: null as { q: string; hits: Hit[]; cur: number } | null,
  /** 다음 보기 보고의 by(사람 · 화면 · focus) */
  by: 'person' as 'person' | 'program' | 'focus',
  /** 그린 뒤 보기에서 깜빡일 것 · 펼칠 표의 줄 */
  after: null as null | { flash?: boolean; table?: boolean; node?: number; elem?: number },
  /** 찾기로 고른 절점 · 요소 — 그 줄을 다시 그린 뒤에도 표시한다(호스트의 메시지가 다시 그리게 해도 사라지지 않게). 다른 것을 고르면 풀린다 */
  mark: null as null | { key: string; node?: number; elem?: number },
};
const STAGE_TO: Record<Stage, [Tab, string]> = {
  sec: ['model', 'sec'], fsm: ['result', 'fsm'], load: ['result', 'load'], chk: ['result', 'chk'], conn: ['result', 'conn'], val: ['work', 'val'],
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const isCheck = (key: string): boolean => !!rowOfKey(key).row;
const hasSheet = (key: string): boolean => !!rowOfKey(key).row?.us && !/#(ls|ne)\d+$/.test(key);

// ── 그리기 ────────────────────────────────────────────────────────
let wasEditing = false;
/** 편집 상태가 바뀌었다(F2 · 단추 · Esc) — 띠의 기준 판을 잡고 푼다 */
function onEditChange(): void {
  const now = editing();
  if (now && !wasEditing) { beginEdit(); }
  if (!now && wasEditing) { endEdit(); }
  wasEditing = now;
  render();
}

// ── 입력만 열었다(V7-01 — 82194ef) ─────────────────────────────────
/**
 * 파일을 열 때 호스트가 결과를 버렸으면(봉인이 맞지 않음 · 다른 엔진) 장부에 cause.action 'open_project' 의 줄이 생긴다 — 그 까닭을
 * 눈에 띄게(제목 표시줄 아래 띠) 보이고 다시 계산하는 길 하나(run_case_check)를 둔다. 결과가 다시 생기거나 닫으면 사라진다
 */
const OPEN_WHY: Array<[RegExp, string]> = [
  [/do not match the inputs saved with them/i, '파일의 결과가 함께 저장된 모델 · 입력과 맞지 않습니다(저장한 뒤 파일이 바뀌었다)'],
  [/not computed by this program on this PC/i, '이 PC 에서 이 프로그램이 계산한 결과가 아닙니다(예: 동료의 파일)'],
  [/another engine/i, '다른 엔진이 계산한 결과입니다'],
];
let noticeDismissed = '';
let recomputing = false;
function openDrop(): { key: string; why: string; kinds: string[] } | null {
  const inv: any[] = Array.isArray(state.full?.invalidated) ? state.full.invalidated : [];
  const drops = inv.filter(e => e?.cause?.action === 'open_project' && OPEN_WHY.some(([re]) => re.test(String(e.reason ?? ''))));
  if (!drops.length) { return null; }
  const last = drops[drops.length - 1];
  const res = state.full?.results ?? {};
  const kinds = [...new Set(drops.filter(e => e.reason === last.reason).map(e => String(e.kind)))].filter(k => !res[k]);
  if (!kinds.length) { return null; }
  const why = OPEN_WHY.find(([re]) => re.test(String(last.reason)))![1];
  return { key: `${String(last.invalidated_at ?? '')}|${String(last.reason)}`, why, kinds };
}
function renderOpenNotice(): void {
  const el = $('opennotice');
  const d = openDrop();
  el.hidden = !d || d.key === noticeDismissed;
  if (!d || el.hidden) { return; }
  const KO: Record<string, string> = { buckling_analysis: '좌굴 해석', load_analysis: '하중 해석', member_design: '부재 검토', design_dsm: '설계용 좌굴값', lap: '랩 접합', connection: '단일 접합' };
  el.innerHTML = `<b data-open-notice>입력만 열었습니다 — ${esc(d.why)}</b><span class="faint">버린 결과: ${esc(d.kinds.map(k => KO[k] ?? k).join(' · '))}</span><span class="sp"></span>`
    + `<span class="btn${recomputing ? ' off' : ''}" data-act="recompute"${tip('화면의 입력으로 부재 검토를 다시 돌린다(run_case_check — 화면의 「설계 검토 실행」과 같은 요청). Claude 에게 「다시 계산해」라고 해도 된다')}>${recomputing ? '계산 중…' : '다시 계산'}</span>`
    + `<span class="btn ghost" data-act="notice-close"${tip('이 알림을 닫는다(까닭은 결과 탭의 낡음에 남는다)')}>닫기</span>`;
}
async function recompute(): Promise<void> {
  if (recomputing) { return; }
  recomputing = true;
  render();
  const d = openDrop();
  const r = await mcp<any>('run_case_check', { what: 'member' });
  let err = r?.error ? String(r.error) : '';
  if (!err && d?.kinds.includes('lap')) { const l = await mcp<any>('run_case_check', { what: 'lap' }); if (l?.error) { err = `랩: ${String(l.error)}`; } }
  recomputing = false;
  if (err) { toast(`다시 계산하지 못했다 — ${err}. Claude 에게 「다시 계산해」라고 해도 된다`, 'warning'); }
  else if (d) { noticeDismissed = d.key; toast('화면의 입력으로 다시 계산했다(부재 검토)', 'info'); }
  scheduleRefresh();
  render();
}

// ── 기록(R1-3) — 띠 · 사람만 하는 일 · 제목 표시줄의 고르기 ─────────────────
function renderBand(): void {
  const el = $('recband');
  const b = bandHtml();
  el.hidden = !b;
  if (b) { el.innerHTML = b.html; el.setAttribute('data-kind', b.kind); }
}
/** 사람만 하는 일 · 대상을 바꾸는 일 — 다리의 /api/person/*. 답의 까닭을 그대로 알린다 */
async function recAct(act: string, el?: HTMLElement | null): Promise<void> {
  const name = el?.getAttribute('data-name') ?? '';
  const kind = el?.getAttribute('data-kind') ?? '';
  let r: { ok: boolean; data?: any; error?: string; status: number } | null = null;
  switch (act) {
    case 'open-folder': r = await person('open-folder'); break;
    case 'new-project': r = await person('new-project'); break;
    case 'open-project': r = await person('open-project', { name }); break;
    case 'open-case': r = await person('open-case', { name }); break;
    case 'new-case':
      if (!state.full?.project?.inProject) {
        if (kind === 'section-only') { toReview(); return; }
        toast('새 검토 대상은 프로젝트 안에 만든다 — 먼저 「폴더에서 열기」나 「새 프로젝트」', 'warning');
        return;
      }
      r = await person('new-case', { kind });
      break;
    case 'make-project': case 'as-new': case 'make-project-now': {
      // 열린 프로젝트가 없으면 묻지 않고 먼저 고르게 한다(다리에 헛걸음하지 않는다). make-project-now = 방금 프로젝트를 고른 뒤의 이어 하기
      r = act === 'make-project-now' || state.full?.project?.inProject ? await person('make-project') : { ok: false, status: 409 };
      if (!r.ok && r.status === 409) {
        // 열린 프로젝트가 없다 — 고르거나 만든 뒤 이어서 복사한다(설계 2.5)
        pendingMake = true;
        const x = (el?.getBoundingClientRect?.() ?? { left: 200, bottom: 80 }) as DOMRect;
        await projectMenu(x.left, x.bottom + 2, '어느 프로젝트로 — 고른 뒤 이어서 복사한다');
        return;
      }
      break;
    }
    case 'take-lock': r = await person('take-lock'); break;
    case 'archive': r = await person('archive', { archived: true }); break;
    case 'save-as': fileOp('save'); return;
    case 'dismiss': rec.outsideDismissed = `${state.full?.project?.case?.name ?? ''}|${rec.status?.saved_at ?? ''}`; render(); return;
    case 'overwrite': toast('덮어쓰기는 호스트가 아직 그 길을 주지 않는다', 'warning'); return;
    default: return;
  }
  if (!r) { return; }
  if (!r.ok) { toast(`${r.error ?? '하지 못했다'}${r.status === 403 ? ' — 사람의 누름이 있어야 한다' : ''}`, 'warning'); }
  else if (r.data?.cancelled) { /* 사람이 물음을 닫았다 */ }
  else {
    const d = r.data ?? {};
    toast(d.opened ? `「${d.opened}」을(를) 열었다` : d.created ? `「${d.created}」을(를) 만들었다` : d.project ? `프로젝트 「${d.project.name}」` : d.took ? `「${d.took}」의 잠금을 넘겨받았다` : '했다', 'info');
    if (d.project || d.opened) { ui.screen = d.opened ? 'review' : ui.screen; }
  }
  await loadRecent(true);
  scheduleRefresh();
  // 「프로젝트로 만들기」가 프로젝트를 고르는 중이었다 — 고른(만든) 뒤 이어서 복사
  if (pendingMake && r.ok && r.data?.project && ['open-project', 'open-folder', 'new-project'].includes(act)) { pendingMake = false; await recAct('make-project-now'); }
}
let pendingMake = false;
async function projectMenu(x: number, y: number, title = '프로젝트'): Promise<void> {
  await loadRecent();
  const cur = state.full?.project?.project?.name;
  const items: MenuItem[] = (rec.recent ?? []).slice(0, 12).map(p => ({ label: `${p.name}${p.name === cur ? ' ●' : ''} · 대상 ${p.cases}`, run: () => { void recAct('open-project', fakeEl({ name: p.name })); } }));
  openMenu([...items, ...(items.length ? ['-' as const] : []), { label: '폴더에서 열기…', run: () => { void recAct('open-folder'); } }, { label: '새 프로젝트…', run: () => { void recAct('new-project'); } }], x, y, title);
}
async function caseMenu(x: number, y: number): Promise<void> {
  const p = state.full?.project;
  if (!p?.inProject) {
    openMenu([{ label: '열기', kbd: 'Ctrl+O', run: () => fileOp('open') }, { label: '저장', kbd: 'Ctrl+S', run: () => fileOp('save') }, '-',
      { label: '프로젝트로 만들기…', run: () => { void recAct('make-project'); }, off: !state.file.name, why: '열린 파일이 없다' }], x, y, '파일');
    return;
  }
  const cs = rec.cases ?? [];
  openMenu([...cs.slice(0, 20).map(c => ({ label: `${c.name}${c.open ? ' ●' : ''} · ${KIND_KO[c.kind] ?? c.kind}`, run: () => { void recAct('open-case', fakeEl({ name: c.name })); } })),
    ...(cs.length ? ['-' as const] : []),
    { label: '새 검토…', run: () => { ui.screen = 'start'; render(); } },
    { label: '저장', kbd: 'Ctrl+S', run: () => fileOp('save') },
    { label: '보관(목록에서 숨김)', run: () => { void recAct('archive'); }, off: !p.case, why: '열린 검토 대상이 없다' }], x, y, `검토 대상 · ${p.project?.name ?? ''}`);
}
const fakeEl = (d: Record<string, string>): HTMLElement => { const e = document.createElement('span'); for (const [k, v] of Object.entries(d)) { e.setAttribute(`data-${k}`, v); } return e; };

function render(): void {
  renderTitle(editing(), questionOpen());
  const strip = $('editstrip');
  strip.hidden = !editing();
  if (editing()) { strip.innerHTML = editStripHtml(pointedAt() ? 1 : 0); }
  renderOpenNotice();
  renderBand();
  renderFollow(following(), !!pointedAt());
  $('start').hidden = ui.screen !== 'start';
  $('tbar').classList.toggle('onstart', ui.screen === 'start');
  $('review').classList.toggle('behind', ui.screen === 'start');
  if (ui.screen === 'start') {
    renderStart($('start'), claudeStatus());
    if (!rec.recent) { void loadRecent().then(() => { if (ui.screen === 'start') { renderStart($('start'), claudeStatus()); } }); }
  }
  renderReview();
  renderStatus();
  renderAiPoint();
  renderFind();
  reportView();
}

function viewName(): string {
  if (ui.sheet) { return 'sheet'; }
  const sel = ui.sel[ui.tab];
  return `${ui.tab}/${groupOf(sel)}:${viewsFor(sel).join('+')}`;
}

/** 보기 보고(0.4 초 모아서) — 고른 것이 없으면 selection null */
function reportView(now = false): void {
  // 시작 화면도 알린다 — 보기 어휘의 `start`(보기 계약 2절)
  if (ui.screen !== 'review') { report('start', null, ui.by, now); ui.by = 'person'; return; }
  const key = ui.sheet ?? ui.sel[ui.tab];
  report(viewName(), itemOfKey(ui.tab, key), ui.by, now);
  ui.by = 'person';
}

function renderReview(): void {
  // 시트가 가리키던 항목이 결과에서 사라졌으면(무효 · 다른 결과) 시트를 닫지 않고 그 까닭을 보인다(sheetHtml)
  const sheetOn = !!ui.sheet;
  $('review').classList.toggle('sheetl', sheetOn);
  $('ttabs').innerHTML = TABS.map(([k, t]) => `<a class="${k === ui.tab ? 'on' : ''}" data-tab="${k}">${esc(t)}</a>`).join('');
  const nodes = buildTree(ui.tab);
  const sel = ui.sheet ?? ui.sel[ui.tab];
  const tree = $('tree');
  const scroll = tree.scrollTop;
  tree.innerHTML = treeHtml(nodes, sel, ui.closed, ui.opened);
  tree.scrollTop = scroll;
  $('rail').innerHTML = `<i data-rail="tree"${tip('트리 펼치기 — 시트 닫기(Esc)')}>☰</i>${TABS.map(([k, t]) => `<i class="${k === ui.tab ? 'on' : ''}" data-rail="${k}"${tip(t)}>${t.charAt(0)}</i>`).join('')}`;
  const center = $('center');
  const t0 = performance.now();
  const c = centerHtml(sel, { w: center.clientWidth || 1240, h: center.clientHeight || 900 });
  center.className = `pane-view ${c.cls}`;
  const drawerScroll = center.querySelector('.drawer')?.scrollTop ?? 0;
  center.innerHTML = c.html;
  restoreZoom(center);
  const dr = center.querySelector('.drawer');
  if (dr) { dr.scrollTop = drawerScroll; }
  if (center.querySelector('[data-v3d]') && modeSel.len !== null) { mount3d(center, modeSel.len, modeSel.mode); }
  state.renderMs = performance.now() - t0;
  if (sheetOn) {
    const sh = $('sheet');
    const sScroll = sh.scrollTop;
    sh.innerHTML = sheetHtml(ui.sheet!, sh.clientWidth || 1000);
    sh.scrollTop = sScroll;
  } else {
    $('sheet').innerHTML = '';
    const info = $('info');
    const infoScroll = info.scrollTop;
    info.innerHTML = infoHtml(sel);
    info.scrollTop = infoScroll;
  }
  renderShare();
  afterRender(center);
}

/** 「Claude 가 보는 선택」 — 호스트가 받아 적은 마지막 보고 그대로(get_view 가 돌려줄 것) */
function renderShare(): void {
  const r = lastReported();
  const el = $('share');
  const b = el.querySelector('b') as HTMLElement;
  const dot = el.querySelector('.dot') as HTMLElement;
  if (!r) { dot.className = 'dot un'; b.textContent = '아직 알리지 않음'; el.removeAttribute('data-item'); return; }
  dot.className = `dot ${r.recorded ? 'ok' : 'un'}`;
  const sel = r.selection;
  // 이름도 받아 적힌 항목의 것 — 지금 고른 것(아직 알리는 중일 수 있다)의 이름을 옛 항목 id 에 붙이지 않는다
  const cur = ui.sheet ?? ui.sel[ui.tab];
  const at = !sel ? null : JSON.stringify(itemOfKey(ui.tab, cur)) === JSON.stringify(r.sent.selection) ? { tab: ui.tab, key: cur } : keyOfItem(sel);
  const label = at ? shareLabel(at.key, findNode(buildTree(at.tab), at.key)?.t) : '';
  const dropKo = r.dropped.length ? ` · 호스트가 버림: ${r.dropped.join(', ')}` : '';
  b.textContent = r.recorded ? `${sel ? `${label ? `${label} · ` : ''}${sel.kind} ${sel.id}` : '고른 것 없음'}${dropKo}` : `알리지 못함 — ${r.error ?? ''}`;
  el.setAttribute('data-item', JSON.stringify(sel));
  el.setAttribute('data-view', r.view ?? '');
  el.setAttribute('data-dropped', r.dropped.join(','));
  el.setAttribute('data-tip', `get_view 가 돌려주는 것 — 화면 review · 보기 ${r.view} · ${sel ? `${sel.kind} ${sel.id}${sel.scope ? ` (${sel.scope})` : ''}` : '고른 것 없음'} · AI 따라가기 ${following() ? '켬' : '끔'}. Claude Desktop 에서 「이거」라고 말하면 이것을 읽는다`);
}

function afterRender(center: HTMLElement): void {
  const a = ui.after;
  ui.after = null;
  // 찾기로 고른 절점 · 요소의 줄 — 다시 그릴 때마다(흔들기 · 스크롤은 처음 한 번만)
  const mk = ui.mark && ui.mark.key === ui.sel[ui.tab] ? ui.mark : null;
  if (!mk) { ui.mark = null; }
  else if (!a) {
    const tb = center.querySelector(`table[data-table="${mk.node !== undefined ? 'nodes' : 'elems'}"]`);
    const want = String(mk.node ?? mk.elem);
    const tr = [...(tb?.querySelectorAll('tbody tr') ?? [])].find(x => x.firstElementChild?.textContent === want) as HTMLElement | undefined;
    tr?.classList.add('on');
  }
  if (!a) { return; }
  if (a.flash) {
    const m = center.querySelector('.loc-mark, rect.selr, table.vt tr.ck.on, rect.bd[stroke="var(--accent)"], g.sel, .sec-geo') as Element | null;
    if (m) { m.classList.add('flash'); (m as HTMLElement).scrollIntoView?.({ block: 'nearest' }); setTimeout(() => m.classList.remove('flash'), 1600); }
  }
  if (a.table) {
    const tr = center.querySelector('.drawer tr.on, .drawer tbody tr') as HTMLElement | null;
    tr?.scrollIntoView({ block: 'center' });
    tr?.classList.add('flash');
  }
  if (a.node !== undefined || a.elem !== undefined) {
    const tb = center.querySelector(`table[data-table="${a.node !== undefined ? 'nodes' : 'elems'}"]`);
    const want = String(a.node ?? a.elem);
    const tr = [...(tb?.querySelectorAll('tbody tr') ?? [])].find(x => x.firstElementChild?.textContent === want) as HTMLElement | undefined;
    if (tr) { tr.classList.add('on', 'flash'); tr.scrollIntoView({ block: 'center' }); }
  }
}

function renderStatus(): void {
  const node = findNode(buildTree(ui.tab), ui.sel[ui.tab]);
  const msg = $('status').querySelector('.msg') as HTMLElement;
  const sr = ui.sheet ? rowOfKey(ui.sheet).row : null;
  msg.textContent = (ui.screen === 'start' ? (state.file.name ? `열린 검토 대상 ${state.file.name}` : '열린 검토 대상 없음')
    : editing() ? `편집 상태 · 이번 편집 ${editChanges().length} · AI 따라가기 ${following() ? '멈춤(편집 중)' : '꺼짐'}`
    : sr ? `계산 시트 · ${sr.where} · ${sr.name} · §${sr.clause}`
      : `${TABS.find(t => t[0] === ui.tab)?.[1] ?? ''} · ${node?.t ?? ''}${state.lastChange ? ` · ${hhmm(state.lastChange.at)} ${state.lastChange.text}` : ''}`).replace(/[‎‏‪-‮⁦-⁩؜]/g, '�');
  const dm = state.runs.find(r => r.us?.design_method)?.us?.design_method;
  ($('status').querySelector('.std') as HTMLElement).innerHTML = `<span${tip(UNITS_NOTE)}>AISI S100-16${dm ? ` · ${esc(dm)}` : ''} · SI</span>`;
  const c = claudeStatus();
  ($('status').querySelector('.ai') as HTMLElement).textContent = c?.lastAiCall ? `AI 마지막 호출 ${hhmm(c.lastAiCall.at)}` : 'AI 호출 없음';
}

/** 「AI 가 가리킴」(따르지 않은 요청 — 누르면 그리로) · 「AI 를 따라왔다 — 까닭」(10 초) */
function renderAiPoint(): void {
  const el = $('aipoint');
  const p = pointedAt();
  const f = lastFollowed();
  if (p) {
    const label = p.target ? (findNode(buildTree(p.target.tab), p.target.key)?.t ?? p.target.key) : `${p.req.item?.kind ?? ''} ${p.req.item?.id ?? ''}`;
    el.hidden = false;
    el.className = `aipoint${p.target ? '' : ' miss'}`;
    el.setAttribute('data-request', p.req.request_id);
    el.innerHTML = `<span class="dot acc"></span><b>AI 가 가리킴</b><span>${esc(label)}</span>${p.req.reason ? `<span class="faint">— ${esc(p.req.reason)}</span>` : ''}`
      + `<span class="faint">(${esc(p.why)})</span>${p.target ? '<span class="btn ghost" data-ai="go">가기</span>' : ''}<span class="btn ghost" data-ai="dismiss"${tip('알림 닫기')}>✕</span>`;
    return;
  }
  if (f && Date.now() - f.at < 10_000) {
    el.hidden = false;
    el.className = 'aipoint followed';
    el.removeAttribute('data-request');
    el.innerHTML = `<span class="dot ok"></span><b>AI 를 따라왔다</b><span>${esc(f.label)}</span>${f.reason ? `<span class="faint">— ${esc(f.reason)}</span>` : ''}`;
    return;
  }
  el.hidden = true;
}

function renderFind(): void {
  const el = $('find');
  if (!ui.find) { el.hidden = true; return; }
  const had = document.activeElement?.id === 'find-q';
  const pos = (document.getElementById('find-q') as HTMLInputElement | null)?.selectionStart ?? ui.find.q.length;
  el.hidden = false;
  el.innerHTML = findHtml(ui.find.q, ui.find.hits, ui.find.cur);
  const inp = document.getElementById('find-q') as HTMLInputElement;
  if (had) { inp.focus(); inp.setSelectionRange(pos, pos); }
}

const rerender = debounce(render, 16);

// ── 고르기 · 탭 ───────────────────────────────────────────────────
function select(tab: Tab, key: string, by: 'person' | 'program' | 'focus' = 'person'): void {
  ui.tab = tab;
  ui.sel[tab] = key;
  if (ui.sheet && key !== ui.sheet) { ui.sheet = hasSheet(key) ? key : null; }
  ui.by = by;
  render();
}

function openSheet(key: string): void {
  if (!hasSheet(key)) { toast('계산 시트는 엔진의 검토 항목(design_checks)에서만 연다', 'warning'); return; }
  ui.screen = 'review';
  ui.tab = 'result';
  ui.sel.result = key;
  ui.sheet = key;
  render();
}
function closeSheet(): void { if (ui.sheet) { ui.sheet = null; render(); } }

function toReview(): void { ui.screen = 'review'; render(); }

// ── 메뉴의 일 ─────────────────────────────────────────────────────
// ── 점검 · 계산서(K3 — 호스트가 만든다) ─────────────────────────────
/**
 * 「점검 실행」 — 끼운 설계 화면의 「설계 검증 실행」을 누른다(그 화면이 늘 쓰던 길: 웹뷰 → 호스트 runValidation → by 'page').
 * MCP validate_design 을 부르지 않는다(그러면 호스트는 AI 가 돌린 것으로 적는다). 끝은 호스트가 그 페이지에 보낸 validationResult 가 알린다
 */
let valTimer: number | null = null;
async function doValidate(): Promise<void> {
  if (state.valRunning) { return; }
  if (!postToWebviews({ type: 'click', id: 'btn-run-validation' }, 'designer')) { toast('입력 화면이 아직 붙지 않았다 — 잠시 뒤 다시', 'warning'); return; }
  setValRunning(true);
  render();
  if (valTimer !== null) { clearTimeout(valTimer); }
  valTimer = window.setTimeout(() => { valTimer = null; if (state.valRunning) { setValRunning(false, '호스트가 답하지 않았다'); toast('점검의 답이 오지 않았다', 'warning'); render(); } }, 20_000);
}
const reportBusy = new Set<string>();
async function doReport(kind: 'design' | 'buckling', format: 'html' | 'pdf'): Promise<void> {
  const k = `${kind}:${format}`;
  if (reportBusy.has(k)) { return; }
  reportBusy.add(k);
  setProgress({ id: `report:${k}`, title: format === 'pdf' ? 'PDF 를 쓰는 중' : '보고서를 만드는 중', message: '호스트' });
  try { await makeReport(kind, format); } finally { reportBusy.delete(k); setProgress({ id: `report:${k}`, done: true }); }
  const r = state.reports[kind];
  if (r?.error) { toast(`보고서를 만들지 못했다 — ${r.error}`, 'warning'); }
  else if (format === 'pdf') { toast(r?.reply?.files?.pdf ? `PDF 를 썼다 — ${String(r.reply.files.pdf)}${r.reply.pages ? ` (${r.reply.pages}쪽)` : ''}` : `PDF 를 쓰지 못했다 — ${String(r?.reply?.pdf_note ?? '')}`, r?.reply?.files?.pdf ? 'info' : 'warning'); }
  render();
}
/** 가운데 · 정보 창의 점검 · 보고서 단추(data-act) — 처리했으면 true */
function docAction(t: HTMLElement): boolean {
  const a = t.closest('[data-act]');
  const act = a?.getAttribute('data-act');
  if (act === 'val-run') { void doValidate(); return true; }
  if (act === 'rpt-make' || act === 'rpt-pdf') {
    const kind = a!.getAttribute('data-kind') === 'buckling' ? 'buckling' : 'design';
    void doReport(kind, act === 'rpt-pdf' ? 'pdf' : 'html');
    return true;
  }
  const d = t.closest('[data-doc]');
  if (d) { select('doc', d.getAttribute('data-doc')!); return true; }
  return false;
}

const tabOfKey = (key: string): Tab => (['sec', 'sdim', 'snode', 'selem', 'sspr', 'scon', 'mat', 'mE', 'mNu', 'mG', 'mFy', 'cond', 'cBC', 'cLc', 'cLen', 'cStr', 'mem', 'ld', 'dc', 'cj', 'asm'].includes(key) || key.startsWith('dc:') || key.startsWith('asm:') ? 'model'
  : ['ask', 'rep', 'chg'].includes(key) ? 'work' : ['rpt', 'brpt', 'vtab', 'src', 'pub'].includes(key) ? 'doc' : 'result');

const SRC_KO: Record<string, string> = {
  props: 'MCP get_section_properties', cutwp: 'MCP get_cutwp', dsm: 'MCP get_dsm_values', full: 'MCP get_full_state', nodes: 'MCP get_nodes', elems: 'MCP get_elements',
  design: '부재 검토 결과(호스트의 designResult)', purlin: '퍼린 검토 결과(designPurlinResult)', lap: '랩 접합 결과(lapConnectionResult)', conn: '접합 결과(connectionResult)',
  loads: '하중 해석(엔진)', curve: '좌굴 곡선(get_buckling_curve)', cls: 'cFSM 분류(analysisComplete)', const: '프로그램의 고정값(엔진 기본)',
};

const handlers: MenuHandlers = {
  find: key => { select(tabOfKey(key), key); ui.after = { flash: true }; render(); },
  onlyHere: key => {
    const r = rowOfKey(key).row;
    if (!r) { return; }
    setTreeFilter({ run: r.run, point: r.point, label: r.where });
    select('result', key);
  },
  sheet: openSheet,
  table: key => {
    const g = groupOf(key);
    const id = g === 'chk' ? 'checks' : g === 'fsm' ? 'curve' : g === 'load' ? 'locations' : g === 'conn' ? 'limits' : '';
    if (id) { setActiveTable(id); openDrawer(g !== 'load'); }
    ui.after = { table: true };
    select(tabOfKey(key), key);
  },
  copy: (text, what) => {
    if (what === 'rv') { return; }
    void copyText(text).then(ok => toast(ok ? `${what}을(를) 복사했다` : '클립보드에 쓰지 못했다', ok ? 'info' : 'warning'));
  },
  source: el => {
    const src = el.getAttribute('data-src') ?? '';
    const i = src.indexOf(':');
    const pre = src.slice(0, i), path = src.slice(i + 1);
    flashTip(el, `출처: ${SRC_KO[pre] ?? pre} · ${path || '—'} · 값 ${el.getAttribute('data-v')} (${el.getAttribute('data-u') || '무차원'}, SI)`, 6000);
  },
  expand: (key, open) => {
    for (const k of keysUnder(buildTree(ui.tab), key)) { if (open) { ui.closed.delete(k); ui.opened.add(k); } else { ui.opened.delete(k); ui.closed.add(k); } }
    render();
  },
  fit: zk => fitZoom(zk, $('center')),
  showItems: (dv, x, y) => {
    const chips = [...dv.querySelectorAll('[data-opt]')] as HTMLElement[];
    const items: MenuItem[] = chips.map(c => ({ label: `${c.classList.contains('on') ? '✓ ' : '  '}${c.textContent ?? ''}`, run: () => { const k = c.getAttribute('data-opt') as keyof CenterOpts; opts[k] = !opts[k]; render(); } }));
    openMenu(items.length ? items : [{ label: '표시 항목 없음', run: () => undefined, off: true }], x + 180, y, '표시 항목');
  },
  copySvg: dv => { const svg = dv.querySelector('svg'); if (svg) { handlers.copy(svg.outerHTML, '그림(SVG)'); } },
  isCheck, hasSheet,
};

function openMenuAtRow(): void {
  const row = $('tree').querySelector('.row.on') as HTMLElement | null;
  if (!row) { return; }
  const r = row.getBoundingClientRect();
  const m = menuAt(row, handlers, r.left + 140, r.top + 14);
  if (m) { openMenu(m.items, r.left + 140, r.top + 14, m.title); }
}

// ── 찾기 ─────────────────────────────────────────────────────────
function openFind(): void { ui.find = ui.find ?? { q: '', hits: [], cur: 0 }; render(); (document.getElementById('find-q') as HTMLInputElement | null)?.focus(); }
function closeFind(): void { ui.find = null; render(); }
function goHit(h: Hit): void {
  ui.find = null;
  ui.screen = 'review';
  if (h.extra) { ui.after = { node: h.extra.node, elem: h.extra.elem }; ui.mark = { key: h.key, node: h.extra.node, elem: h.extra.elem }; }
  if (ui.sheet && hasSheet(h.key)) { ui.sheet = h.key; }
  select(h.tab, h.key);
}

// ── 다리의 상태 · 이벤트 ──────────────────────────────────────────
const scheduleRefresh = debounce(() => { void refresh(() => { if (ui.sheet && !rowOfKey(ui.sheet).row) { /* 항목이 사라졌다 — 시트는 그 까닭을 보인다 */ } render(); }); }, 250);

function applyState(s: any): void {
  if (!s) { return; }
  state.designerId = s.designer;
  if (!themeFixed && (s.theme === 'light' || s.theme === 'dark')) {
    theme = s.theme;
    themeFixed = true;
    document.documentElement.setAttribute('data-theme', theme);
  }
  setWebviewOrigin(s.webviewOrigin);
  initEdit(theme, onEditChange);
  setFile(s.currentFile, s.currentName);
  const designer = (s.webviews ?? []).find((w: any) => w.id === s.designer);
  if (designer) { mountDesigner(designer.url); }
  for (const w of s.webviews ?? []) { if (w.id !== s.designer) { showSide(w); } }
  for (const q of s.platform?.pending ?? []) { enqueue(q); }
  for (const p of s.platform?.progress ?? []) { setProgress(p); }
  if (state.file.path) { ui.screen = 'review'; }
  scheduleRefresh();
}

function setFile(file: string | null | undefined, name: string | null | undefined): void {
  state.file = { path: file ?? null, name: name ?? null };
}

const NOTE: Record<string, string> = {
  modelLoaded: '모델이 바뀌었다', analysisComplete: '좌굴 해석 결과가 들어왔다', analysisInvalidated: '입력이 바뀌어 결과를 지웠다',
  designResult: '부재 검토 결과가 들어왔다', designPurlinResult: '퍼린 검토 결과가 들어왔다', loadAnalysisComplete: '하중 해석 결과가 들어왔다',
  lapConnectionResult: '랩 접합 결과가 들어왔다', connectionResult: '접합 결과가 들어왔다', resultsCleared: '다른 파일을 열었다', resultsLedger: '결과의 최신 여부가 바뀌었다',
  derivedResultsInvalidated: '하중 입력이 바뀌어 부재 검토 · 랩 결과를 지웠다',
};

/** AI 의 focus 요청 — 결과를 먼저 다시 읽고(그 사이 들어온 결과에 있을 수 있다) 따르거나 알림으로 */
async function onFocus(req: FocusReq): Promise<void> {
  await new Promise<void>(ok => { void refresh(() => ok()); });
  const followed = handleFocus(req, {
    editing: editing(),
    label: key => findNode(buildTree(tabOfKey(key)), key)?.t ?? key,
    go: (tab, key) => {
      ui.screen = 'review';
      if (ui.sheet) { ui.sheet = hasSheet(key) ? key : null; }
      ui.after = { flash: true };
      select(tab, key, 'focus');
    },
  });
  if (!followed) { render(); }
  // 따라갔으면 by: 'focus', 아니면 사람이 고른 그대로 — 어느 쪽이든 focus_response 를 곧바로 싣는다
  ui.by = followed ? 'focus' : 'person';
  reportView(true);
}

function onEvent(ev: { type: string; data: any; at: number }): void {
  const d = ev.data ?? {};
  switch (ev.type) {
    case 'platform:question': enqueue(d); break;
    case 'platform:answered': answered(d.qid); break;
    case 'platform:notify': toast(String(d.message ?? ''), d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info'); break;
    case 'platform:progress': setProgress(d); break;
    case 'webview:created': if (d.id !== state.designerId) { showSide(d); } break;
    case 'webview:html': reloadSide(d.id); break;
    case 'webview:disposed': hideSide(d.id); break;
    // R1-3: 사람만 하는 일이 프로젝트 · 대상을 바꿨다(다리) — 다시 읽는다
    case 'person:changed': void loadRecent(true).then(() => scheduleRefresh()); break;
    case 'file:current':
      setFile(d.file, d.name);
      if (d.file) { ui.screen = 'review'; }
      scheduleRefresh();
      rerender();
      break;
    case 'claude:status': renderClaude(d as ClaudeStatus); rerender(); break;
    case 'host:message': {
      const c = String(d.command ?? '');
      if (c === 'focusRequest') { if (d.focus) { void onFocus(d.focus as FocusReq); } break; }
      if (c === 'caseDiscarded') {
        // 저장하지 않은 변경을 버리고 다른 파일을 열었다(K2-6 — AI 의 load_project 를 막지 않는다, 알리기만)
        const x = d.discarded ?? {};
        toast(`저장하지 않은 변경을 버리고 열었다(${/load_project|mcp|ai/i.test(String(x.by ?? '')) ? 'AI 의 load_project' : '열기'})${Array.isArray(x.inputs_changed) && x.inputs_changed.length ? ` — 입력 ${x.inputs_changed.length}칸` : ''}${x.model_changed ? ' · 모델' : ''}`, 'warning');
        state.lastChange = { at: ev.at || Date.now(), text: '저장하지 않은 변경을 버리고 열었다' };
      }
      // 편집 상태의 검증 탭에서 「설계 검증 실행」을 눌렀다(K3 — 호스트가 그 페이지에 항목을 보냈다): 이 화면도 같은 호스트 동작으로 다시 읽는다
      if (c === 'validationResult') {
        // 호스트가 점검을 했다(이 화면 · 편집 화면의 「설계 검증 실행」 = by page, AI 의 validate_design = by ai) — 다시 읽는다
        if (valTimer !== null) { clearTimeout(valTimer); valTimer = null; }
        setValRunning(false);
        state.lastChange = { at: ev.at || Date.now(), text: d.validation?.by === 'ai' ? 'AI 가 점검했다(validate_design)' : '점검했다' };
        scheduleRefresh();
        break;
      }
      if (c === 'reportResult') { break; }
      if (c === 'analysisStarted') { setRunning(true); }
      if (['analysisComplete', 'analysisError', 'analysisInvalidated', 'resultsCleared', 'dsmResult'].includes(c)) { setRunning(false); }
      if (NOTE[c]) { state.lastChange = { at: ev.at || Date.now(), text: NOTE[c] }; }
      if (!['propertiesResult', 'propertiesError', 'captureSection', 'collectDesignData', 'showSection'].includes(c)) { scheduleRefresh(); }
      break;
    }
    default:
  }
}

// ── Claude 연결(S4 와 같은 경로) ─────────────────────────────────
async function refreshClaude(): Promise<void> {
  const r = await api<ClaudeStatus>('GET', '/api/claude/status');
  if (r.success && r.data) { renderClaude(r.data); rerender(); }
}
async function claudeOp(op: 'connect' | 'disconnect'): Promise<void> {
  const r = await api<{ result: { ok: boolean; message: string }; status: ClaudeStatus }>('POST', `/api/claude/${op}`, {});
  if (r.success && r.data) {
    toast(r.data.result.message, r.data.result.ok ? 'info' : 'error');
    claudeDone(r.data.status);
  } else {
    toast(r.error ?? 'Claude 연결을 바꾸지 못했다', 'error');
    claudeDone(claudeStatus());
  }
  rerender();
}

/**
 * 사람의 「열기」 · 「저장」 — 끼운 설계 화면의 Open · Save 단추를 누른다(그 화면이 늘 쓰던 길: 웹뷰 → 호스트 → 열기/저장 물음).
 * 다리에 상태를 바꾸는 새 경로를 두지 않는다.
 */
function fileOp(action: 'open' | 'save'): void {
  if (postToWebviews({ type: 'click', id: action === 'open' ? 'btn-file-open' : 'btn-file-save' }, 'designer')) { return; }
  toast('입력 화면이 아직 붙지 않았다 — 잠시 뒤 다시', 'warning');
}

/** 테마 — 페이지를 다시 싣지 않는다(보는 자리 · 끼운 화면의 입력이 그대로). 끼운 웹뷰에는 메시지로 */
function setTheme(t: 'dark' | 'light'): void {
  theme = t;
  themeFixed = true;
  document.documentElement.setAttribute('data-theme', t);
  setEditTheme(t);
  postToWebviews({ type: 'theme', theme: t });
  render();
}

// ── 키 ───────────────────────────────────────────────────────────
function onKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement)?.closest?.('#dialog-host')) { return; }
  if (menuKey(e)) { e.preventDefault(); return; }
  if (e.key === 'Escape' && editing() && !(e.target as HTMLElement)?.closest?.('input, textarea, select')) { e.preventDefault(); setEditing(false); return; }
  if (e.key === 'F2') { e.preventDefault(); toggleEditing(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); fileOp('open'); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); fileOp('save'); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); openFind(); return; }
  const inInput = !!(e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]');
  if (inInput) { return; }
  if (ui.screen !== 'review' || editing()) { return; }
  const key = ui.sheet ?? ui.sel[ui.tab];
  if (e.key === 'Escape') {
    if (ui.sheet) { closeSheet(); } else if (treeFilter) { setTreeFilter(null); render(); } else if (pointedAt()) { clearPointed(); render(); }
    return;
  }
  if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') { e.preventDefault(); openMenuAtRow(); return; }
  if (e.altKey && ui.sheet && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const nb = neighbours(ui.sheet);
    const to = e.key === 'ArrowLeft' ? nb.prev : nb.next;
    if (to) { e.preventDefault(); openSheet(to.key); }
    return;
  }
  if (e.ctrlKey || e.altKey || e.metaKey) {
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && !String(window.getSelection() ?? '')) {
      const name = findNode(buildTree(ui.tab), key)?.t;
      if (name) { e.preventDefault(); handlers.copy(name, '이름'); }
    }
    return;
  }
  if (e.key === 'Enter' && isCheck(key)) { e.preventDefault(); openSheet(key); return; }
  if (e.key === 'f' || e.key === 'F') { handlers.find(key); return; }
  if ((e.key === 'i' || e.key === 'I') && isCheck(key)) { handlers.onlyHere(key); return; }
  if (e.key === ' ' && isCheck(key)) { e.preventDefault(); toast('확인 표시는 기록(R4)부터 — 지금은 꺼져 있다', 'info'); return; }
  if (e.key === 'Home') { for (const z of ['section', 'mode', 'curve', 'member', 'lap']) { fitZoom(z, $('center')); } }
}

// ── 시작 ─────────────────────────────────────────────────────────
function boot(): void {
  installTips();
  installMenuClosers();
  installIdle();
  initDialogs(() => renderTitle(editing(), questionOpen()));
  initEdit(theme, onEditChange);
  onReport(() => renderShare());
  initTitlebar($('tbar'), {
    file: fileOp,
    edit: toggleEditing,
    claude: op => { void claudeOp(op); },
    stage: st => { const [tab, key] = STAGE_TO[st]; ui.screen = 'review'; select(tab, key); },
    find: openFind,
    follow: () => { setFollowing(!following()); render(); reportView(true); },
    caseMenu, projectMenu: (x, y) => projectMenu(x, y),
  });
  initStart($('start'), { open: () => fileOp('open'), review: toReview, claude: op => { void claudeOp(op); }, rec: (act, el) => { void recAct(act, el); } });
  $('recband').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('[data-rec]') as HTMLElement | null;
    if (b && !b.classList.contains('off')) { void recAct(b.getAttribute('data-rec')!, b); }
  });

  $('ttabs').addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-tab]');
    if (a) { ui.tab = a.getAttribute('data-tab') as Tab; render(); }
  });
  $('rail').addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-rail]');
    if (!a) { return; }
    const r = a.getAttribute('data-rail')!;
    ui.sheet = null;
    if (r !== 'tree') { ui.tab = r as Tab; }
    render();
  });
  $('tree').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const r = t.closest('.row') as HTMLElement | null;
    if (!r) { return; }
    const k = r.getAttribute('data-k') ?? '';
    if (t.closest('.tw') && t.closest('.tw')!.textContent) {
      if (ui.closed.has(k) || t.closest('.tw')!.textContent === '▸') { ui.closed.delete(k); ui.opened.add(k); } else { ui.closed.add(k); ui.opened.delete(k); }
      render();
      return;
    }
    if (k === 'chk:filter') { setTreeFilter(null); render(); return; }
    select(ui.tab, k);
  });
  $('tree').addEventListener('dblclick', e => {
    const r = (e.target as HTMLElement).closest('.row') as HTMLElement | null;
    const k = r?.getAttribute('data-k') ?? '';
    if (isCheck(k)) { openSheet(k); }
  });
  installZoom($('center'));
  $('center').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (docAction(t)) { return; }
    const sel = ui.sheet ?? ui.sel[ui.tab];
    const chip = t.closest('[data-opt]');
    if (chip) { const k = chip.getAttribute('data-opt') as keyof CenterOpts; opts[k] = !opts[k]; render(); return; }
    const vw = t.closest('[data-view]');
    if (vw) {
      const v = vw.getAttribute('data-view') as V;
      const cur = viewsFor(sel);
      const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v].slice(-3);
      setViews(sel, next.length ? next : [v]);
      render();
      return;
    }
    const fit = t.closest('[data-fit]');
    if (fit) { fitZoom(fit.getAttribute('data-fit')!, $('center')); return; }
    const pick = t.closest('[data-pick]');
    if (pick) {
      const p = pick.getAttribute('data-pick')!;
      if (p.startsWith('len:')) { const i = Number(p.slice(4)); if (Number.isFinite(i)) { modeSel.len = i; modeSel.mode = 1; render(); } return; }
      if (p.startsWith('pt:')) { select('result', p.slice(3)); return; }
      if (p.startsWith('run:')) {
        const run = p.slice(4);
        const r = state.runs.find(x => x.key === run);
        const row = r?.rows.find(x => x.pass === false) ?? r?.rows.find(x => x.governs) ?? r?.rows[0];
        if (row) { select('result', row.key); }
        return;
      }
    }
    const dt = t.closest('[data-dtab]');
    if (dt) { setActiveTable(dt.getAttribute('data-dtab')!); render(); return; }
    if (t.closest('[data-drawer="toggle"]')) { toggleDrawer(); render(); return; }
    const cp = t.closest('[data-copy]');
    if (cp) {
      const tb = tablesFor(groupOf(sel)).find(x => x.id === cp.getAttribute('data-copy'));
      if (tb) { void copyText(tsvOf(tb)).then(ok => toast(ok ? `「${tb.title}」 표를 복사했다` : '클립보드에 쓰지 못했다', ok ? 'info' : 'warning')); }
      return;
    }
    const th = t.closest('.drawer th[data-sort]');
    if (th) { const id = th.closest('.drawer')!.getAttribute('data-table-id')!; sortBy(id, Number(th.getAttribute('data-sort'))); render(); return; }
    const lenRow = t.closest('tr[data-k^="len:"]');
    if (lenRow) { modeSel.len = Number(lenRow.getAttribute('data-k')!.slice(4)); modeSel.mode = 1; render(); return; }
    const tr = t.closest('tr[data-k]');
    if (tr) { select('result', tr.getAttribute('data-k') ?? 'chk'); }
  });
  $('center').addEventListener('dblclick', e => {
    const tr = (e.target as HTMLElement).closest('tr[data-k]');
    const k = tr?.getAttribute('data-k') ?? '';
    if (isCheck(k)) { openSheet(k); }
  });
  $('info').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (docAction(t)) { return; }
    const lnk = t.closest('[data-sheet]');
    if (lnk) { openSheet(lnk.getAttribute('data-sheet')!); return; }
    const tr = t.closest('tr[data-k]');
    if (tr) { select('result', tr.getAttribute('data-k') ?? 'chk'); }
  });
  $('info').addEventListener('dblclick', e => {
    const k = (e.target as HTMLElement).closest('tr[data-k]')?.getAttribute('data-k') ?? '';
    if (isCheck(k)) { openSheet(k); }
  });
  $('sheet').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-sheet-close]')) { closeSheet(); return; }
    const go = t.closest('[data-sheet-go]');
    if (go) { openSheet(go.getAttribute('data-sheet-go')!); return; }
    const hd = t.closest('[data-card-head]');
    if (hd) { const k = hd.getAttribute('data-card-head')!; if (k !== ui.sheet) { openSheet(k); } }
  });
  $('opennotice').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-act="recompute"]')) { void recompute(); return; }
    if (t.closest('[data-act="notice-close"]')) { noticeDismissed = openDrop()?.key ?? ''; render(); }
  });
  $('editstrip').addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('[data-act="edit-done"]')) { setEditing(false); }
  });
  $('aipoint').addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-ai]');
    if (!a) { return; }
    const p = takePointed();
    if (a.getAttribute('data-ai') === 'go' && p?.target) {
      ui.screen = 'review';
      if (ui.sheet) { ui.sheet = hasSheet(p.target.key) ? p.target.key : null; }
      ui.after = { flash: true };
      select(p.target.tab, p.target.key, 'person');
    } else { render(); }
  });
  $('find').addEventListener('input', e => {
    const inp = e.target as HTMLInputElement;
    if (inp.id !== 'find-q' || !ui.find) { return; }
    ui.find = { q: inp.value, hits: search(inp.value), cur: 0 };
    renderFind();
  });
  $('find').addEventListener('keydown', e => {
    if (!ui.find) { return; }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = ui.find.hits.length;
      if (n) { ui.find.cur = (ui.find.cur + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderFind(); }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); const h = ui.find.hits[ui.find.cur]; if (h) { goHit(h); } }
  });
  $('find').addEventListener('click', e => {
    const fi = (e.target as HTMLElement).closest('[data-fi]');
    if (fi && ui.find) { const h = ui.find.hits[Number(fi.getAttribute('data-fi'))]; if (h) { goHit(h); } }
  });
  document.addEventListener('mousedown', e => {
    if (ui.find && !(e.target as HTMLElement).closest('#find, [data-act="find"]')) { ui.find = null; renderFind(); }
  });
  document.addEventListener('contextmenu', e => {
    const t = e.target as HTMLElement;
    if (t.closest('#dialog-host, #edit, input, textarea')) { return; }
    const m = menuAt(t, handlers, e.clientX, e.clientY);
    if (!m) { return; }
    e.preventDefault();
    // 우클릭한 트리 줄은 고른다(템플릿과 같이 — 메뉴는 그 줄의 것)
    const row = t.closest('#tree .row') as HTMLElement | null;
    if (row && row.getAttribute('data-k') !== ui.sel[ui.tab]) { select(ui.tab, row.getAttribute('data-k') ?? ''); }
    openMenu(m.items, e.clientX, e.clientY, m.title);
  });
  document.addEventListener('keydown', onKey);
  // 끼운 웹뷰 안에서 누른 F2 도 편집 상태를 끈다(웹뷰는 다른 출처 — 다리의 수신부가 메시지로 알려 준다)
  onWebviewF2(toggleEditing);

  window.addEventListener('resize', debounce(render, 150));
  connectEvents(h => applyState(h.state), onEvent);
  void refreshClaude();
  setInterval(() => { void refreshClaude(); }, 10_000);
  // 「AI 를 따라왔다」 알림을 10 초 뒤 거둔다
  setInterval(() => { const f = lastFollowed(); if (f && Date.now() - f.at >= 10_000 && !$('aipoint').hidden && !pointedAt()) { renderAiPoint(); } }, 2000);
  render();
}

// 시험이 읽는 것(화면 상태 — 쓰기 길은 없다)
(window as unknown as { __stcfsdUi: unknown }).__stcfsdUi = {
  get state() { return state; },
  get ui() { return { screen: ui.screen, tab: ui.tab, sel: ui.sel[ui.tab], editing: editing(), sheet: ui.sheet, follow: following(), idleMs: idleFor(), filter: treeFilter, menu: menuOpen() }; },
  select: (tab: Tab, key: string) => { ui.screen = 'review'; select(tab, key); },
  review: toReview,
  /** 시험: 시작 화면으로(제목 표시줄의 「새 검토…」와 같은 길) */
  start: () => { ui.screen = 'start'; render(); },
  get modeSel() { return { ...modeSel }; },
  setLen: (i: number, m = 1) => { modeSel.len = i; modeSel.mode = m; render(); },
  views: (v: V[]) => { setViews(ui.sel[ui.tab], v); render(); },
  setTheme,
  openSheet, closeSheet,
  get reported() { return lastReported(); },
  /** 시험: 「점검 실행」 · 보고서 만들기와 같은 길(사람의 단추와 같은 함수) */
  validate: () => doValidate(),
  report: (kind: 'design' | 'buckling', format: 'html' | 'pdf') => doReport(kind, format),
  /** 시험: 보기 보고 하나를 곧바로(모델 · 상태를 쓰지 않는다 — 호스트가 무엇을 버리고 칩이 그것을 보이는지 본다) */
  reportNow: (view: string, selection: unknown) => report(view, selection as Item | null, 'program', true),
  get pointed() { return pointedAt(); },
  checkMenu: (key: string) => checkMenu(key, '', handlers).map(x => (x === '-' ? '-' : `${x.label}|${x.kbd ?? ''}|${x.off ? 'off' : 'on'}`)),
  closeMenu,
};

boot();
