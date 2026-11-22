/**
 * 새 검토 화면(U1) 진입점 — 다리의 이벤트를 받아 상태를 다시 읽고, 트리 · 보기 · 정보 창 · 진행 띠를 다시 그린다.
 *
 * 화면이 따라가는 것: 호스트가 설계 패널에 보내는 메시지(`host:message` — AI 의 MCP 호출이든 편집 상태의 단추든 같은 길)가
 * 오면 0.25 초 뒤 다시 읽는다. 보는 자리(탭 · 고른 줄)는 바꾸지 않는다(구성안 3.9). 낡은 결과는 그 순간 지워진 채로 보인다.
 * AI 따라가기 · 찾기 · 우클릭 메뉴 · 계산 시트는 U3, 그림 보기는 U2 의 일이다.
 */
import { api, connectEvents } from './bridge';
import { centerHtml, opts, type CenterOpts } from './center';
import { answered, enqueue, initDialogs, questionOpen, setProgress, toast } from './dialogs';
import { debounce, esc, tip } from './dom';
import { editing, hideSide, initEdit, mountDesigner, reloadSide, showSide, toggleEditing } from './edit';
import { hhmm } from './format';
import { infoHtml, shareLabel } from './info';
import { installMenuClosers } from './menu';
import { initStart, renderStart } from './start';
import { refresh, setRunning, state, type Stage } from './store';
import { installTips } from './tips';
import { claudeDone, claudeStatus, initTitlebar, renderClaude, renderTitle, type ClaudeStatus } from './titlebar';
import { buildTree, findNode, TABS, treeHtml, type Tab } from './tree';
import { UNITS_NOTE } from './units';

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
};
const STAGE_TO: Record<Stage, [Tab, string]> = {
  sec: ['model', 'sec'], fsm: ['result', 'fsm'], load: ['result', 'load'], chk: ['result', 'chk'], conn: ['result', 'conn'], val: ['work', 'val'],
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

// ── 그리기 ────────────────────────────────────────────────────────
function render(): void {
  renderTitle(editing(), questionOpen());
  $('start').hidden = ui.screen !== 'start';
  $('tbar').classList.toggle('onstart', ui.screen === 'start');
  $('review').classList.toggle('behind', ui.screen === 'start');
  if (ui.screen === 'start') { renderStart($('start'), claudeStatus()); }
  renderReview();
  renderStatus();
}

function renderReview(): void {
  $('ttabs').innerHTML = TABS.map(([k, t]) => `<a class="${k === ui.tab ? 'on' : ''}" data-tab="${k}">${esc(t)}</a>`).join('');
  const nodes = buildTree(ui.tab);
  const sel = ui.sel[ui.tab];
  const tree = $('tree');
  const scroll = tree.scrollTop;
  tree.innerHTML = treeHtml(nodes, sel, ui.closed);
  tree.scrollTop = scroll;
  const center = $('center');
  const c = centerHtml(sel, { w: center.clientWidth || 1240, h: center.clientHeight || 900 });
  center.className = `pane-view ${c.cls}`;
  const drawerScroll = center.querySelector('.drawer')?.scrollTop ?? 0;
  center.innerHTML = c.html;
  const dr = center.querySelector('.drawer');
  if (dr) { dr.scrollTop = drawerScroll; }
  const info = $('info');
  const infoScroll = info.scrollTop;
  info.innerHTML = infoHtml(sel);
  info.scrollTop = infoScroll;
  const node = findNode(nodes, sel);
  ($('share').querySelector('b') as HTMLElement).textContent = shareLabel(sel, node?.t);
}

function renderStatus(): void {
  const node = findNode(buildTree(ui.tab), ui.sel[ui.tab]);
  const msg = $('status').querySelector('.msg') as HTMLElement;
  msg.textContent = ui.screen === 'start' ? (state.file.name ? `열린 검토 대상 ${state.file.name}` : '열린 검토 대상 없음')
    : `${TABS.find(t => t[0] === ui.tab)?.[1] ?? ''} · ${node?.t ?? ''}${state.lastChange ? ` · ${hhmm(state.lastChange.at)} ${state.lastChange.text}` : ''}`;
  const dm = state.runs.find(r => r.us?.design_method)?.us?.design_method;
  ($('status').querySelector('.std') as HTMLElement).innerHTML = `<span${tip(UNITS_NOTE)}>AISI S100-16${dm ? ` · ${esc(dm)}` : ''} · SI</span>`;
  const c = claudeStatus();
  ($('status').querySelector('.ai') as HTMLElement).textContent = c?.lastAiCall ? `AI 마지막 호출 ${hhmm(c.lastAiCall.at)}` : 'AI 호출 없음';
}

const rerender = debounce(render, 16);

// ── 고르기 · 탭 ───────────────────────────────────────────────────
function select(tab: Tab, key: string): void {
  ui.tab = tab;
  ui.sel[tab] = key;
  render();
}

function toReview(): void { ui.screen = 'review'; render(); }

// ── 다리의 상태 · 이벤트 ──────────────────────────────────────────
const scheduleRefresh = debounce(() => { void refresh(render); }, 250);

function applyState(s: any): void {
  if (!s) { return; }
  state.designerId = s.designer;
  if (!themeFixed && (s.theme === 'light' || s.theme === 'dark')) {
    theme = s.theme;
    themeFixed = true;
    document.documentElement.setAttribute('data-theme', theme);
  }
  initEdit(theme, render);
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
  lapConnectionResult: '랩 접합 결과가 들어왔다', connectionResult: '접합 결과가 들어왔다', resultsCleared: '다른 파일을 열었다',
};

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
    case 'file:current':
      setFile(d.file, d.name);
      if (d.file) { ui.screen = 'review'; }
      scheduleRefresh();
      rerender();
      break;
    case 'claude:status': renderClaude(d as ClaudeStatus); rerender(); break;
    case 'host:message': {
      const c = String(d.command ?? '');
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
 * 다리에 상태를 바꾸는 새 경로를 두지 않는다(맨 위 창만 부를 수 있게 막는 일은 다리의 몫 — 그 전에 늘리지 않는다).
 */
function fileOp(action: 'open' | 'save'): void {
  try {
    const d = ($('designer') as HTMLIFrameElement).contentDocument;
    const b = d?.getElementById(action === 'open' ? 'btn-file-open' : 'btn-file-save') as HTMLButtonElement | null;
    if (b) { b.click(); return; }
  } catch { /* 아직 안 붙음 */ }
  toast('입력 화면이 아직 붙지 않았다 — 잠시 뒤 다시', 'warning');
}

/** 테마 — 페이지를 다시 싣지 않는다(보는 자리 · 끼운 화면의 입력이 그대로). 끼운 설계 화면은 다음에 실을 때부터 새 테마 */
function setTheme(t: 'dark' | 'light'): void {
  theme = t;
  themeFixed = true;
  document.documentElement.setAttribute('data-theme', t);
  render();
}

// ── 시작 ─────────────────────────────────────────────────────────
function boot(): void {
  installTips();
  installMenuClosers();
  initDialogs(() => renderTitle(editing(), questionOpen()));
  initEdit(theme, render);
  initTitlebar($('tbar'), {
    file: fileOp,
    edit: toggleEditing,
    claude: op => { void claudeOp(op); },
    stage: st => { const [tab, key] = STAGE_TO[st]; ui.screen = 'review'; select(tab, key); },
  });
  initStart($('start'), { open: () => fileOp('open'), review: toReview, claude: op => { void claudeOp(op); } });

  $('ttabs').addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-tab]');
    if (a) { ui.tab = a.getAttribute('data-tab') as Tab; render(); }
  });
  $('tree').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const r = t.closest('.row') as HTMLElement | null;
    if (!r) { return; }
    const k = r.getAttribute('data-k') ?? '';
    if (t.closest('.tw') && t.closest('.tw')!.textContent) {
      if (ui.closed.has(k) || t.closest('.tw')!.textContent === '▸') { ui.closed.delete(k); } else { ui.closed.add(k); }
      render();
      return;
    }
    select(ui.tab, k);
  });
  $('center').addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const chip = t.closest('[data-opt]');
    if (chip) { const k = chip.getAttribute('data-opt') as keyof CenterOpts; opts[k] = !opts[k]; render(); return; }
    const tr = t.closest('tr[data-k]');
    if (tr) { select('result', tr.getAttribute('data-k') ?? 'chk'); }
  });
  $('info').addEventListener('click', e => {
    const tr = (e.target as HTMLElement).closest('tr[data-k]');
    if (tr) { select('result', tr.getAttribute('data-k') ?? 'chk'); }
  });
  document.addEventListener('keydown', e => {
    if ((e.target as HTMLElement)?.closest?.('#dialog-host')) { return; }
    if (e.key === 'F2') { e.preventDefault(); toggleEditing(); return; }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); fileOp('open'); }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); fileOp('save'); }
  });
  // 끼운 웹뷰 안에서 누른 F2 도 편집 상태를 끈다(같은 출처라 문서에 듣는 것을 단다)
  ($('designer') as HTMLIFrameElement).addEventListener('load', () => {
    try {
      ($('designer') as HTMLIFrameElement).contentWindow?.document.addEventListener('keydown', e => {
        if (e.key === 'F2') { e.preventDefault(); toggleEditing(); }
      });
    } catch { /* 다른 출처면 듣지 않는다 */ }
  });

  window.addEventListener('resize', debounce(render, 150));
  connectEvents(h => applyState(h.state), onEvent);
  void refreshClaude();
  setInterval(() => { void refreshClaude(); }, 10_000);
  render();
}

// 시험이 읽는 것(화면 상태 — 쓰기 길은 없다)
(window as unknown as { __stcfsdUi: unknown }).__stcfsdUi = {
  get state() { return state; }, get ui() { return { screen: ui.screen, tab: ui.tab, sel: ui.sel[ui.tab], editing: editing() }; },
  select: (tab: Tab, key: string) => { ui.screen = 'review'; select(tab, key); },
  review: toReview,
  setTheme,
};

boot();
