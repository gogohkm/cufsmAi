/**
 * R4-2 — 확인 표시(기록 설계 §5.7 · 보기 계약 4h). 사람만 — 표시 · 믿기는 다리의 사람 길(`/api/person/review` · `/api/person/trust`)로만,
 * MCP 중계로 보내지 않는다. 읽기는 호스트 동작 `get_reviews`(MCP 도구와 같은 읽기).
 *
 *  - 줄 ↔ 항목: `get_reviews.items[]` 의 {scope, id, location, combination} 을 화면의 검토 줄과 같은 꼴로 맞댄다(퍼린 = {region, check_point}).
 *  - `shown` 은 화면이 **그린** 때의 지문 — 그린 항목의 `fp`(items) · `result_fps` · 변경 id 를 그대로 돌려보낸다(다시 읽은 값이 아니다).
 *    지금 지문과 다르면 호스트가 거절한다 → 다시 읽고 그 까닭을 알린다.
 *  - ✓ 확인 · ◌ 다시 확인(풍선에 why_ko 와 다른 곳) · 없음 미확인. 「확인 n/N」 · 「다시 확인 m」. 다른 작성자의 표시는 세지 않는다(not_counted).
 *  - 확인의 뜻(D15)은 호스트가 준 한국어 글(`meaning_ko`) 그대로.
 *  - 업무 항목 · 가정은 그 판의 순번(`seq`)을, 입력 묶음(템플릿 01)은 `group_fps[g]` 를 shown 으로(de93aa9).
 */
import { mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm } from './format';
import { person } from './records';
import { state, type CheckRow } from './store';

export interface ReviewItem {
  type: string; key?: string; scope?: string; id?: string; location?: unknown; combination?: string | null; verdict?: string | null; ratio?: number | null; fp?: string;
  state: 'reviewed' | 'review-again' | 'unreviewed'; reviewer?: string; at?: string; how?: string; why?: string; why_ko?: string;
  differences?: Array<{ path: string; reviewed: unknown; current: unknown }>; kind?: string; change?: string; item?: string; seq?: number; last_seq?: number; group?: string;
}
export const rv: {
  items: ReviewItem[]; byKey: Map<string, ReviewItem>; resultFps: Record<string, string>; reviewed: number; total: number; again: number;
  notCounted: Array<{ reviewer: string; status: string; at: string; why: string }>; writers: Array<{ name: string; host: string; trusted: boolean; writer_id?: string }>;
  meaning: string; groupFps: Record<string, string>; err?: string; loaded: boolean;
} = { items: [], byKey: new Map(), resultFps: {}, reviewed: 0, total: 0, again: 0, notCounted: [], writers: [], meaning: '', groupFps: {}, loaded: false };

/** 위치의 정규 꼴(키 차례 무관) — 줄과 항목을 맞대는 데만 */
function canon(v: unknown): string {
  if (v === null || v === undefined) { return 'null'; }
  if (Array.isArray(v)) { return `[${v.map(canon).join(',')}]`; }
  if (typeof v === 'object') { return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(',')}}`; }
  return JSON.stringify(v);
}
const keyOf = (scope: unknown, id: unknown, loc: unknown, comb: unknown) => `${String(scope)}|${String(id)}|${canon(loc ?? null)}|${comb ?? ''}`;

/** 화면의 검토 줄 → 그 항목(없으면 null) */
export function itemOfRow(r: CheckRow): ReviewItem | null {
  if (!r.us) { return null; }
  let loc: unknown = r.locUS ?? null;
  if (r.scope === 'purlin') {
    const i = Number(String(r.run).split(':')[1]);
    loc = { region: state.regions[i]?.us?.id ?? null, check_point: r.pointName };
  }
  return rv.byKey.get(keyOf(r.scope, r.id, loc, r.combination ?? null)) ?? null;
}

export async function loadReviews(): Promise<void> {
  if (!state.full?.project?.case) { rv.items = []; rv.byKey.clear(); rv.loaded = false; rv.reviewed = rv.total = rv.again = 0; return; }
  const r = await mcp<any>('get_reviews', { limit: 200 });
  if (!r || r.error) { rv.err = String(r?.error ?? '읽지 못함'); return; }
  rv.err = undefined;
  rv.loaded = true;
  rv.items = Array.isArray(r.items) ? r.items : [];
  rv.byKey = new Map(rv.items.filter(x => x.type === 'check').map(x => [keyOf(x.scope, x.id, x.location ?? null, x.combination ?? null), x]));
  rv.resultFps = r.result_fps && typeof r.result_fps === 'object' ? r.result_fps : {};
  rv.reviewed = Number(r.reviewed) || 0; rv.total = Number(r.total) || 0; rv.again = Number(r.review_again) || 0;
  rv.notCounted = Array.isArray(r.not_counted) ? r.not_counted : [];
  rv.writers = Array.isArray(r.writers) ? r.writers : [];
  rv.meaning = typeof r.meaning_ko === 'string' ? r.meaning_ko : typeof r.meaning === 'string' ? r.meaning : '';
  rv.groupFps = r.group_fps && typeof r.group_fps === 'object' ? r.group_fps : {};
}

/** 표시가 붙은 다른 것(결과 · 변경 · 업무 · 가정) */
export const markOf = (type: string, id: string): ReviewItem | null =>
  rv.items.find(x => x.type === type && (type === 'result' ? x.kind === id : type === 'change' ? x.change === id : x.item === id)) ?? null;

// ── 그리기 ──────────────────────────────────────────────────────────
/** 풍선 — 상태 · 누가 · 언제 · 다시 확인의 까닭과 다른 곳 */
export function markTip(it: ReviewItem | null): string {
  if (!it || it.state === 'unreviewed') { return '미확인 — Space 로 확인 표시(사람만)'; }
  const who = `${it.reviewer ?? ''} · ${hhmm(it.at)}`;
  if (it.state === 'reviewed') { return `확인 ✓ · ${who}${it.how === 'same-content' ? ' · 그 뒤 다시 계산했지만 같은 내용' : ''}`; }
  const diff = (it.differences ?? []).slice(0, 3).map(d => `${d.path}: ${String(d.reviewed)} → ${String(d.current)}`).join(' · ');
  return `다시 확인 ◌ · ${it.why_ko ?? it.why ?? ''}${diff ? ` · ${diff}` : ''} · 확인 ${who}`;
}
export const glyph = (it: ReviewItem | null): string => (!it || it.state === 'unreviewed' ? ''
  : `<span class="rvg ${it.state === 'reviewed' ? 'ok' : 'again'}" data-rv-state="${it.state}"${tip(markTip(it))}>${it.state === 'reviewed' ? '✓' : '◌'}</span>`);

/** 정보 창 머리의 「확인」 단추 — attrs 로 대상(data-rv-*)을 싣는다. off 면 까닭만 */
export function markButton(it: ReviewItem | null, attrs: string, off?: string): string {
  if (off) { return `<span class="rv off" data-rv-off${tip(off)}>확인</span>`; }
  const on = it?.state === 'reviewed', again = it?.state === 'review-again';
  return `<span class="rv${on ? ' on' : ''}${again ? ' again' : ''}" ${attrs} data-rv-state="${it?.state ?? 'unreviewed'}"${tip(`${markTip(it)}. ${rv.meaning}`)}>${on ? '✓ 확인' : again ? '◌ 다시 확인' : '확인'}</span>`;
}
/** 확인의 뜻(D15) — 호스트가 준 글 그대로 */
export const meaningHtml = (): string => (rv.meaning ? `<div class="faint" data-rv-meaning>${esc(rv.meaning)}</div>` : '');

/** 다른 작성자의 표시(세지 않는다) — 「이름 (PC) · 아직 믿지 않음」 + 「믿기」(작성자 id 가 있을 때만) */
export function othersHtml(): string {
  const ws = rv.writers.filter(w => !w.trusted);
  if (!rv.notCounted.length && !ws.length) { return ''; }
  const rows = rv.notCounted.slice(0, 6).map(u => `<li data-not-counted>${esc(u.reviewer)} · ${esc(hhmm(u.at))} · 아직 믿지 않음</li>`).join('');
  const btns = ws.map(w => (w.writer_id
    ? (trustAsk === w.writer_id ? trustQuestion(w)
      : `<span class="btn ghost" data-rv-trust-ask="${esc(w.writer_id)}"${tip('이 작성자를 믿을지 묻는다 — 이름 · 작성자 id · PC 를 보이고')}>${esc(w.name)} (${esc(w.host)}) 믿기…</span>`)
    : `<span class="btn ghost off"${tip('호스트의 get_reviews.writers 에 작성자 id 가 없다 — 믿기를 부를 수 없다(호스트에 바람)')}>${esc(w.name)} (${esc(w.host)}) · 아직 믿지 않음</span>`)).join(' ');
  return `<div class="sec"><h4${tip('다른 PC · 작성자의 확인 표시 — 믿기 전에는 세지 않는다')}>다른 작성자의 확인<span class="sp"></span></h4>${rows ? `<ul class="notes faint">${rows}</ul>` : ''}${btns}</div>`;
}

/**
 * S5: 「믿기」 물음 — 작성자 카드의 이름은 그 작성자가 스스로 적은 것(폴더에 쓰는 쪽이 동료의 이름을 흉내 낼 수 있다). 그래서 이름 옆에
 * 작성자 id(서명 열쇠에서 나온 것 — 줄여서)와 PC 이름을 보이고, 이름은 주장이라고 말한다. 「믿기」 는 이 물음의 단추로만
 */
export let trustAsk: string | null = null;
export function askTrust(id: string | null): void { trustAsk = id; }
const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
function trustQuestion(w: { name: string; host: string; writer_id?: string }): string {
  const id = String(w.writer_id ?? '');
  return `<div class="banner warn" data-rv-trust-question="${esc(id)}"><b>이 작성자를 믿는가?</b> 이름 「${esc(w.name)}」 은 그 작성자가 스스로 적은 것이다 — 다른 사람의 이름일 수 있다.`
    + `<dl class="kv"><dt>작성자 id</dt><dd class="num" data-writer-id${tip(id)}>${esc(shortId(id))}</dd><dt>PC</dt><dd data-writer-host>${esc(w.host)}</dd><dt>적은 이름</dt><dd>${esc(w.name)}</dd></dl>`
    + `<span class="faint">믿으면 이 작성자 id 의 확인 표시를 이 PC 에서 센다. 같은 이름이라도 id 가 다르면 다른 작성자다.</span><div class="btns">`
    + `<span class="btn" data-rv-trust="${esc(id)}">믿기</span><span class="btn ghost" data-rv-trust-ask="">그만</span></div></div>`;
}

// ── 누르기 ──────────────────────────────────────────────────────────
export interface MarkTarget { type: string; key?: string; kind?: string; changeId?: string; id?: string; group?: string; shown: string | number }
/** 표시 · 풀기(사람의 길). 거절이면 그 까닭을 돌려준다 */
export async function mark(targets: MarkTarget[], on: boolean): Promise<{ ok: boolean; why?: string; code?: string }> {
  if (!targets.length) { return { ok: false, why: '고른 것이 없다' }; }
  const r = await person('review', { mark: on, targets });
  if (!r.ok) { return { ok: false, why: `${r.error ?? '하지 못했다'}${r.status === 403 ? ' — 사람의 누름이 있어야 한다' : ''}`, ...(r.code ? { code: r.code } : {}) }; }
  return { ok: true };
}
export function rowTarget(r: CheckRow): MarkTarget | null {
  const it = itemOfRow(r);
  return it?.key && it.fp ? { type: 'check', key: it.key, shown: it.fp } : null;
}
export async function trust(writer: string): Promise<{ ok: boolean; why?: string }> {
  const r = await person('trust', { writer_id: writer, trust: true });
  return r.ok ? { ok: true } : { ok: false, why: r.error };
}

/** 업무 항목 · 가정의 확인 단추 — 그 판의 순번(seq)을 shown 으로. 답 없는 판단 요청은 호스트가 거절한다(host.review.no_answer) */
export function itemMarkButton(type: 'work' | 'assumption', id: string, seq: unknown): string {
  if (typeof seq !== 'number') { return markButton(null, '', '이 항목의 판(seq)을 아직 읽지 못했다 — 다시 읽는 중'); }
  return markButton(markOf(type, id), `data-rv-item="${esc(type)}|${esc(id)}|${seq}"`);
}
/** 입력 묶음의 확인 단추(템플릿 01) — 묶음마다 shown = get_reviews.group_fps[g]. 모두 확인이면 ✓, 하나라도 다시 확인이면 ◌ */
export function groupMarkButton(groups: string[]): string {
  if (!rv.loaded) { return markButton(null, '', '확인 표시는 프로젝트의 검토 대상에서만'); }
  const gs = groups.filter(g => rv.groupFps[g]);
  if (!gs.length) { return markButton(null, '', '이 묶음의 지문이 호스트의 group_fps 에 없다'); }
  const its = gs.map(g => rv.items.find(x => x.type === 'group' && x.group === g) ?? null);
  const st = its.some(x => x?.state === 'review-again') ? its.find(x => x?.state === 'review-again')! : its.every(x => x?.state === 'reviewed') ? its[0] : null;
  return markButton(st, `data-rv-groups="${esc(gs.map(g => `${g}=${rv.groupFps[g]}`).join(','))}"`);
}
/** 템플릿 01 의 정보 창 → 호스트의 입력 묶음 */
export const BRANCH_GROUPS: Record<string, string[]> = { section: ['section'], material_model: ['material_model'], mem: ['member'], ld: ['loads', 'deck'],
  dc: ['design', 'required', 'options', 'method', 'webCrippling', 'holes', 'stiffeners', 'torsion', 'vibration'], cj: ['connection', 'lap'], mat: ['material'] };
