/**
 * 「Claude 가 보는 선택」과 「AI 따라가기」(구성안 3.9 · 보기 계약 docs/implementation/20261123-view-contract.md).
 *
 *  - 보기 보고: 고른 것 · 보기가 바뀔 때마다(0.4 초 모아서) 호스트 액션 `report_view` 를 부른다
 *    `{screen:'review', view, selection: item | null, follows_focus, by, focus_response?}` — 다리의 MCP 중계(AI 호출로 세지 않는다).
 *    정보 창 아래 칩은 마지막으로 **호스트가 받아 적은**(recorded) 보고 그대로다 — `get_view` 가 돌려줄 것.
 *  - focus 요청(`focusRequest` — 다리가 이벤트에 본문을 실어 한 번만 보낸다): 「AI 따라가기」가 켜져 있고, 사람이 5 초 넘게 가만히 있고,
 *    편집 상태가 아니면 그 항목을 고르고 보인다(by: 'focus'). 아니면 움직이지 않고 「AI 가 가리킴」 알림(한 번 누르면 그리로)을 남긴다.
 *    이 화면의 지금 결과에 없는 항목이면 따르지 않고 그렇다고 보인다. 어느 쪽이든 다음 보고에 focus_response 를 싣는다.
 *  - 하지 않는 것: 창의 포커스를 가져가지 않는다(window.focus 를 부르지 않는다), 모델을 바꾸지 않는다, 편집 상태를 스스로 열지 않는다.
 */
import { chg } from './changes';
import { asm, srcs, work } from './work';
import { mcp } from './bridge';
import { allRows, state, type CheckRow, type Scope } from './store';

export interface Item { kind: 'check' | 'model' | 'result' | 'validation' | 'record'; id: string; scope?: Scope; location?: any; type?: 'change' | 'work' | 'assumption' | 'source' }
export interface FocusReq { request_id: string; item: Item; reason: string | null; requested_at?: string }
export type Tab = 'work' | 'model' | 'result' | 'doc';

const IDLE_MS = 5000;
let lastInput = 0;
const KEY = 'stcfsd.ui.follow.v1';
let followOn = false;
try { followOn = localStorage.getItem(KEY) === '1'; } catch { /* 없음 */ }

/** 사람의 입력(마우스 · 키 · 휠) — 5 초 규칙 */
export function installIdle(): void {
  const mark = () => { lastInput = Date.now(); };
  for (const t of ['mousedown', 'keydown', 'wheel', 'pointermove', 'touchstart']) { document.addEventListener(t, mark, { capture: true, passive: true }); }
}
export const idleFor = (): number => Date.now() - lastInput;
export const following = (): boolean => followOn;
export function setFollowing(on: boolean): void {
  followOn = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 저장 못 해도 화면은 돈다 */ }
}

// ── 키 ↔ 항목 id ────────────────────────────────────────────────────
const MODEL_ID: Record<string, string> = {
  sec: 'section', sdim: 'section', snode: 'section', selem: 'section', sspr: 'springs', scon: 'constraints',
  mat: 'material', mE: 'material', mNu: 'material', mG: 'material', cond: 'boundary_condition', cBC: 'boundary_condition',
  cLc: 'load_case', cLen: 'lengths', cStr: 'load_case',
};
const RESULT_ID: Record<string, string> = {
  fsm: 'buckling_analysis', 'fsm:fam': 'buckling_analysis', 'fsm:l': 'buckling_analysis.local', 'fsm:d': 'buckling_analysis.distortional', 'fsm:g': 'buckling_analysis.global',
  load: 'load_analysis', 'load:gov': 'load_analysis', 'load:loc': 'load_analysis', 'load:def': 'load_analysis',
  chk: 'member_design', 'chk:NG': 'member_design', 'chk:UN': 'member_design', 'chk:OK': 'member_design', 'chk:NA': 'member_design',
  conn: 'connection', 'conn:one': 'connection', 'conn:lap': 'lap', props: 'section',
};

/**
 * 검토 항목 → item. 위치는 호스트가 받는 것만 — 퍼린의 `{region, check_point}`, 엔진의 `{segment}`(보기 계약 2절, V5c-02).
 * 수 · 글(x · 지점 번호 · 근거)은 보내지 않는다 — 호스트가 버릴 것이고 AI 의 문맥에 들어가지 않아야 한다
 */
export function itemOfRow(r: CheckRow): Item {
  const l = r.locUS && typeof r.locUS === 'object' ? r.locUS : null;
  const loc = l && (l.region || l.check_point) ? { ...(l.region ? { region: String(l.region) } : {}), ...(l.check_point ? { check_point: String(l.check_point) } : {}) }
    : l && typeof l.segment === 'string' ? { segment: l.segment } : null;
  return { kind: 'check', id: r.id, scope: r.scope, ...(loc ? { location: loc } : {}) };
}

/** 화면의 고른 것 → item(없으면 null) */
export function itemOfKey(tab: Tab, key: string): Item | null {
  // 점검 항목 — 보기 계약의 kind 'validation'(id val.* — 마지막 점검에 있는 것만, 4b99968). 묶음 · 점검 전체는 그 어휘에 없다
  if (key.startsWith('val#')) { const id = key.slice(4); return /^val\./.test(id) ? { kind: 'validation', id } : null; }
  // 보기 계약의 record(373d81f) — 변경 · 업무 항목 · 가정 · 원자료 한 줄
  const rk = /^(chg|work|asmr|srcr):(.+)$/.exec(key);
  if (rk) { return { kind: 'record', type: ({ chg: 'change', work: 'work', asmr: 'assumption', srcr: 'source' } as const)[rk[1] as 'chg' | 'work' | 'asmr' | 'srcr'], id: rk[2] }; }
  if (key === 'val' || key.startsWith('val:cat:')) { return null; }
  if (key.includes('#')) {
    const r = allRows().find(x => x.key === key);
    if (r && r.us) { return itemOfRow(r); }
    if (key.startsWith('purlin:')) {
      const i = Number(key.split(':')[1].split('#')[0]);
      const rg = state.regions[i];
      if (rg?.us?.id) { return { kind: 'result', id: `purlin.region.${String(rg.us.id)}` }; }
    }
    return { kind: 'result', id: 'member_design' };
  }
  // 2026-11-28 결정 S8: 퍼린 단면(그 결과의 단면 블록) — 보기 계약의 어휘로는 부재 검토 결과
  if (key === 'psec' || key.startsWith('psec:')) { return { kind: 'result', id: 'member_design' }; }
  if (tab === 'model' && MODEL_ID[key]) { return { kind: 'model', id: MODEL_ID[key] }; }
  if (RESULT_ID[key]) { return { kind: key === 'props' ? 'model' : 'result', id: RESULT_ID[key] }; }
  return null;
}

/** item → 화면의 탭 · 키. 이 화면의 지금 결과에 없으면 null */
export function keyOfItem(item: Item): { tab: Tab; key: string } | null {
  if (!item || typeof item !== 'object') { return null; }
  if (item.kind === 'check') {
    const loc = item.location ?? {};
    const cands = allRows().filter(r => r.id === item.id && (!item.scope || r.scope === item.scope) && r.us);
    if (!cands.length) { return null; }
    let hit = cands[0];
    if (item.scope === 'purlin' && (loc.region || loc.check_point)) {
      const m = cands.find(r => (!loc.region || String(r.locUS?.region ?? '') === String(loc.region))
        && (!loc.check_point || String(r.locUS?.check_point ?? r.pointName ?? '') === String(loc.check_point)));
      if (!m) { return null; }
      hit = m;
    }
    return { tab: 'result', key: hit.key };
  }
  // 보기 계약의 `record {type, id}`(373d81f) — 지금 화면의 목록에 있는 줄만
  if (item.kind === 'record') {
    const id = String(item.id);
    const t = item.type ?? 'change';
    if (t === 'change') { return chg.list.some(c => c.id === id) ? { tab: 'work', key: `chg:${id}` } : null; }
    if (t === 'work') { return work.items.some(w => w.item === id) ? { tab: 'work', key: `work:${id}` } : null; }
    if (t === 'assumption') { return asm.items.some(a => a.item === id) ? { tab: 'model', key: `asmr:${id}` } : null; }
    if (t === 'source') { return srcs.items.some(x => x.item === id) ? { tab: 'doc', key: `srcr:${id}` } : null; }
    return null;
  }
  if (item.kind === 'validation') {
    const id = String(item.id);
    return (state.val?.items ?? []).some(x => x.id === id) ? { tab: 'result', key: `val#${id}` } : null;
  }
  if (item.kind === 'model') {
    const id = String(item.id);
    if (id === 'section') { return { tab: 'model', key: 'sec' }; }
    if (/^section\.node\.\d+$/.test(id)) { return { tab: 'model', key: 'snode' }; }
    if (/^section\.element\.\d+$/.test(id)) { return { tab: 'model', key: 'selem' }; }
    const m: Record<string, string> = { material: 'mat', boundary_condition: 'cBC', lengths: 'cLen', springs: 'sspr', constraints: 'scon', load_case: 'cLc' };
    return m[id] ? { tab: 'model', key: m[id] } : null;
  }
  const id = String(item.id);
  const r: Record<string, string> = {
    buckling_analysis: 'fsm', 'buckling_analysis.local': 'fsm:l', 'buckling_analysis.distortional': 'fsm:d', 'buckling_analysis.global': 'fsm:g',
    load_analysis: 'load', member_design: 'chk', connection: 'conn:one', lap: 'conn:lap',
  };
  if (r[id]) {
    if ((id === 'connection' && !state.conn) || (id === 'lap' && !state.lap) || (id === 'load_analysis' && !state.loads)) { return null; }
    return { tab: 'result', key: r[id] };
  }
  if (/^load_analysis\.support\.\d+$/.test(id)) { return state.loads ? { tab: 'result', key: 'load' } : null; }
  const pm = /^purlin\.region\.(.+)$/.exec(id);
  if (pm) {
    const i = state.regions.findIndex(x => String(x.us?.id) === pm[1]);
    if (i < 0) { return null; }
    const run = state.runs.find(x => x.key === `purlin:${i}`);
    const k = (run?.rows.find(x => x.pass === false) ?? run?.rows[0])?.key;
    return k ? { tab: 'result', key: k } : null;
  }
  return null;
}

// ── 보기 보고 ───────────────────────────────────────────────────────
/** 호스트가 받아 적은 것 — 버린 칸(dropped)은 빼고(selection · view 를 버렸으면 null) */
export interface Reported { view: string | null; selection: Item | null; by: string; recorded: boolean; error?: string; at: number; dropped: string[]; sent: { view: string; selection: Item | null } }
let reported: Reported | null = null;
/** focus_response.note 는 코드만(보기 계약 2절): followed · not_in_results · follow_off · editing · busy */
export type FocusNote = 'followed' | 'not_in_results' | 'follow_off' | 'editing' | 'busy';
let pendingResp: { request_id: string; followed: boolean; note?: FocusNote } | null = null;
let timer: number | null = null;
let lastSent = '';
/** 기다리는(아직 보내지 않은) 보고의 서명 · 보낸 차례 · 답을 받아 적은 차례 */
let pendingSig: string | null = null;
let sentSeq = 0;
let replySeq = 0;
let onReported: (() => void) | null = null;

export function lastReported(): Reported | null { return reported; }
export function onReport(cb: () => void): void { onReported = cb; }

/** 보고 — 같은 것이면 보내지 않는다(focus_response 가 있으면 보낸다). now = 모으지 않고 곧바로 */
export function report(view: string, selection: Item | null, by: 'person' | 'program' | 'focus', now = false): void {
  const body = { screen: 'review', view, selection, follows_focus: followOn, by };
  // 같은 보기 · 고른 것을 다시 알릴 때 「누가」만 바뀌면 보내지 않는다(AI 를 따라간 보고를 뒤의 다시 그리기가 「사람」으로 덮지 않게)
  const sig = JSON.stringify({ ...body, by: undefined });
  // 이미 보낸 것으로 돌아왔다 — 기다리던 다른 보고는 버린다(늦게 나가 호스트에 옛 고른 것을 남기지 않게)
  if (sig === lastSent && !pendingResp) { if (timer !== null) { clearTimeout(timer); timer = null; pendingSig = null; } return; }
  // 같은 것이 이미 기다린다 — 다시 그릴 때마다 시계를 새로 걸지 않는다(잇단 다시 그리기가 보고를 한없이 미루지 않게: 바뀐 뒤 0.4 초 안에 나간다)
  if (!now && timer !== null && sig === pendingSig) { return; }
  if (timer !== null) { clearTimeout(timer); timer = null; }
  pendingSig = sig;
  const send = () => {
    timer = null;
    pendingSig = null;
    const resp = pendingResp;
    pendingResp = null;
    lastSent = sig;
    const my = ++sentSeq;
    void mcp<{ recorded?: boolean; error?: string; dropped?: unknown }>('report_view', { ...body, ...(resp ? { focus_response: resp } : {}) }).then(r => {
      // 답은 따로 오므로 차례가 바뀔 수 있다 — 나중에 보낸 것의 답이 이미 왔으면 앞의 답으로 덮지 않는다(호스트도 마지막에 받은 것을 둔다)
      if (my < replySeq) { return; }
      replySeq = my;
      const dropped = Array.isArray(r?.dropped) ? r.dropped.map(String) : [];
      const sel = dropped.includes('selection') ? null
        : selection && dropped.includes('selection.location') ? (({ location: _l, ...rest }) => rest)(selection) as Item : selection;
      reported = { view: dropped.includes('view') ? null : view, selection: sel, by, recorded: r?.recorded !== false && !r?.error, error: r?.error, at: Date.now(), dropped, sent: { view, selection } };
      onReported?.();
    });
  };
  if (now) { send(); } else { timer = window.setTimeout(send, 400); }
}

// ── focus 요청 ──────────────────────────────────────────────────────
export interface Pointed { req: FocusReq; target: { tab: Tab; key: string } | null; why: string; at: number }
let pointed: Pointed | null = null;
let followedNote: { reason: string | null; at: number; label: string } | null = null;
const seen = new Set<string>();

export const pointedAt = (): Pointed | null => pointed;
export const lastFollowed = (): typeof followedNote => followedNote;
export function clearPointed(): void { pointed = null; }

/**
 * 한 번만 — 같은 request_id 는 다시 따르지 않는다. go = 화면을 그 탭 · 키로(고르기만, 모델은 그대로).
 * 돌려주는 것: 따라갔는가
 */
export function handleFocus(req: FocusReq, ctx: { editing: boolean; go: (tab: Tab, key: string, label: string) => void; label: (key: string) => string }): boolean {
  if (!req || typeof req.request_id !== 'string' || seen.has(req.request_id)) { return false; }
  seen.add(req.request_id);
  const target = keyOfItem(req.item);
  if (!target) {
    pointed = { req, target: null, why: '이 화면의 지금 결과에 그 항목이 없다', at: Date.now() };
    pendingResp = { request_id: req.request_id, followed: false, note: 'not_in_results' };
    return false;
  }
  const label = ctx.label(target.key);
  const why = !followOn ? 'AI 따라가기가 꺼져 있다' : ctx.editing ? '편집 상태다' : idleFor() < IDLE_MS ? '사람이 작업 중이다(5 초 안에 입력)' : '';
  if (why) {
    pointed = { req, target, why, at: Date.now() };
    pendingResp = { request_id: req.request_id, followed: false, note: !followOn ? 'follow_off' : ctx.editing ? 'editing' : 'busy' };
    return false;
  }
  pointed = null;
  followedNote = { reason: req.reason, at: Date.now(), label };
  pendingResp = { request_id: req.request_id, followed: true, note: 'followed' };
  ctx.go(target.tab, target.key, label);
  return true;
}

/** 「AI 가 가리킴」 알림을 눌렀다 — 사람이 그리로 간다(그 요청에 대한 답은 이미 보냈다) */
export function takePointed(): Pointed | null { const p = pointed; pointed = null; return p; }
