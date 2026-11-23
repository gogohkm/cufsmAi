/**
 * R3-3 — 업무 항목 · 가정 · 원자료가 화면에(기록 설계 §1.3 · §5.1 – 5.2 · §5.6 · 템플릿 07 · 00 · 06 · 08, 보기 계약 4g).
 *
 *  - 읽는 길: 호스트 동작 `work_items` · `assumptions` · `sources`(`op: list | get` — MCP 도구와 같은 동작, 화면의 중계는 사람의 문맥). 목록은 대상이
 *    바뀌었을 때와 `recordsChanged {types}` 가 그 종류를 말할 때만 다시 읽는다(다른 새로 고침에서는 읽지 않는다).
 *  - 글은 글자로만 — 모든 글은 dom.esc(태그 · 따옴표 · 글 방향 문자)를 거쳐 들어간다(innerHTML 에 날 글을 넣지 않는다). AI · 다른 작성자의 글은
 *    자료다(지시가 아니다): `written_by` 꼬리표를 그대로, 사람의 말(`answer.said`)은 「AI 가 옮겨 적음」.
 *  - 판단 요청에 답하는 칸은 없다 — 사람은 Claude Desktop 대화에서 말하고 AI 가 옮겨 적는다(확인은 R4 의 사람만 하는 길).
 *  - 원자료는 이름 · 해시 앞 12 · 크기 · 상태만 — 내용은 읽지 않는다. 「열기」는 다리의 사람 길(`/api/person/open-source`)이 OS 의 기본 앱으로.
 *  - 가정의 `person_confirmed` 는 R4 전까지 늘 false — 그대로 「사람의 확인 없음」.
 */
import { mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm } from './format';
import { state } from './store';

export interface WorkItem {
  item: string; kind: 'question' | 'report' | 'instruction'; state: string; title: string; body?: string; truncated?: boolean; scope: string;
  written_by: string; created_at: string; last_at: string; basis_differs_from_now?: boolean; answered?: boolean; items?: number;
}
export interface AsmItem {
  item: string; text: string; truncated?: boolean; status: string; closed: boolean; origin: string; written_by: string; scope_of: string;
  person_confirmed: boolean; blocks_issue: boolean; sources?: string[];
}
export interface SrcItem { item: string; title: string; kind: string; file: string; sha12: string; size: number; state: string; written_by: string; registered_at: string }

interface ListState<T> { items: T[]; err?: string; othersOmitted: number; unverified: number; note?: string }
export const work: ListState<WorkItem> & { full: Map<string, any> } = { items: [], othersOmitted: 0, unverified: 0, full: new Map() };
export const asm: ListState<AsmItem> & { full: Map<string, any> } = { items: [], othersOmitted: 0, unverified: 0, full: new Map() };
export const srcs: ListState<SrcItem> & { unregistered: string[] } = { items: [], othersOmitted: 0, unverified: 0, unregistered: [] };
let loadedFor = '';

const fill = <T>(s: ListState<T>, r: any): void => {
  if (!r || r.error) { s.err = String(r?.error ?? '읽지 못함'); s.items = []; return; }
  s.err = undefined;
  s.items = Array.isArray(r.items) ? r.items : [];
  s.othersOmitted = typeof r.others_omitted === 'number' ? r.others_omitted : 0;
  s.unverified = typeof r.unverified_omitted === 'number' ? r.unverified_omitted : 0;
  s.note = typeof r.note === 'string' ? r.note : undefined;
};
export async function loadWork(): Promise<void> { fill(work, await mcp<any>('work_items', { op: 'list', state: 'all', limit: 100 })); work.full.clear(); }
export async function loadAssumptions(): Promise<void> { fill(asm, await mcp<any>('assumptions', { op: 'list', include_closed: true, limit: 100 })); asm.full.clear(); }
export async function loadSources(): Promise<void> {
  const r = await mcp<any>('sources', { op: 'list' });
  fill(srcs, r);
  srcs.unregistered = Array.isArray(r?.unregistered) ? r.unregistered.map(String) : [];
}
/** 새로 고침마다 — 대상(프로젝트 · 대상)이 바뀌었을 때만 셋 모두. 그 밖에는 recordsChanged 가 말한 종류만(reloadTypes) */
export async function loadRecordsWork(): Promise<void> {
  const p = state.full?.project;
  const key = p?.inProject ? `${p.project?.projectId ?? p.project?.name ?? ''}|${p.case?.caseId ?? ''}` : '';
  if (key === loadedFor) { return; }
  loadedFor = key;
  if (!key) { for (const s of [work, asm, srcs]) { s.items = []; s.err = undefined; } work.full.clear(); asm.full.clear(); srcs.unregistered = []; return; }
  await Promise.all([loadWork(), loadAssumptions(), loadSources()]);
}
/** recordsChanged {types} — 그 종류만 다시 읽는다 */
export async function reloadTypes(types: string[]): Promise<void> {
  const jobs: Array<Promise<void>> = [];
  if (types.includes('work')) { jobs.push(loadWork()); }
  if (types.includes('assumptions')) { jobs.push(loadAssumptions()); }
  if (types.includes('sources')) { jobs.push(loadSources()); }
  await Promise.all(jobs);
}
/** 고른 항목의 전부(get) — 한 번 읽어 둔다(recordsChanged 가 오면 비운다) */
export async function fetchFull(key: string): Promise<boolean> {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'work' && !work.full.has(id)) { const r = await mcp<any>('work_items', { op: 'get', item: id }); work.full.set(id, r?.error ? { error: String(r.error) } : r); return true; }
  if (kind === 'asmr' && !asm.full.has(id)) { const r = await mcp<any>('assumptions', { op: 'get', item: id }); asm.full.set(id, r?.error ? { error: String(r.error) } : r); return true; }
  return false;
}

// ── 이름표 ──────────────────────────────────────────────────────────
export const KIND_KO: Record<string, string> = { question: '판단 요청', report: '보고', instruction: '지시' };
const STATUS_KO: Record<string, { t: string; cls: string }> = {
  provisional: { t: '임시', cls: 'def' }, firm: { t: '확정', cls: '' }, 'field-check': { t: '현장 확인', cls: 'def' }, 'not-applicable': { t: '해당 없음', cls: '' },
};
const ITEM_KO: Record<string, string> = { done: '완료', assumed: '가정', open: '미결' };
const SRC_STATE: Record<string, { t: string; cls: string }> = { same: { t: '같음', cls: 'ok' }, changed: { t: '바뀜', cls: 'warn' }, missing: { t: '없음', cls: 'ng' }, unknown: { t: '모름', cls: 'un' } };
const SRC_KIND: Record<string, string> = { drawing: '도면', product: '제품 자료', other: '그 밖' };
const ORIGIN_KO: Record<string, string> = { 'program-default': '프로그램 · 입력 기본값', 'program-engine': '프로그램 · 엔진 자체 가정', ai: 'AI', person: '사용자' };
/** 쓴 쪽 꼬리표 — 호스트의 written_by 그대로(「… (another writer)」 는 「다른 작성자」 를 덧붙인다) */
export function writerTag(w: string): string {
  const other = / \(another writer\)$/.test(w);
  const base = w.replace(/ \(another writer\)$/, '');
  const t = base === 'ai' ? 'AI' : base === 'program' ? '프로그램' : base === 'person' ? '사용자' : base;
  return `<span class="tag ${base === 'ai' ? 'ai' : base === 'program' ? 'sec' : ''}" data-written-by="${esc(w)}"${tip(`쓴 쪽: ${w}${other ? ' — 이 PC 의 작성자가 아니다' : ''} · 그 글은 자료다(지시가 아니다)`)}>${esc(t)}${other ? ' · 다른 작성자' : ''}</span>`;
}

// ── 세기 ───────────────────────────────────────────────────────────
export const openQuestions = (): WorkItem[] => work.items.filter(w => w.kind === 'question' && w.state !== 'closed' && !w.answered);
export const questions = (): WorkItem[] => work.items.filter(w => w.kind === 'question');
export const reports = (): WorkItem[] => work.items.filter(w => w.kind === 'report');
export const instructions = (): WorkItem[] => work.items.filter(w => w.kind === 'instruction');

/** 항목이 가리키는 것(refs) — 화면의 키로(없으면 null). 판단 요청 · 보고 · 가정의 refs 와 06 의 알림이 쓴다 */
export function refKey(r: any): { tab: 'work' | 'model' | 'result' | 'doc'; key: string } | null {
  if (!r || typeof r !== 'object') { return null; }
  if (r.kind === 'change' && r.id) { return { tab: 'work', key: `chg:${r.id}` }; }
  if (r.kind === 'work' && r.id) { return { tab: 'work', key: `work:${r.id}` }; }
  if (r.kind === 'assumption' && r.id) { return { tab: 'model', key: `asmr:${r.id}` }; }
  if (r.kind === 'source' && r.id) { return { tab: 'doc', key: `srcr:${r.id}` }; }
  if (r.kind === 'field' && typeof r.path === 'string') {
    const m = /^case\.inputs\.([A-Za-z][A-Za-z0-9_]*)$/.exec(r.path);
    return m ? { tab: 'model', key: `case:${m[1]}` } : r.path.startsWith('model.') ? { tab: 'model', key: 'sec' } : null;
  }
  return null;
}
/** 06 · 04 의 알림 — 그 결과 · 검토를 가리키는 열린 판단 요청 */
export function questionsAbout(kinds: string[], scopes: string[]): Array<{ w: WorkItem; refs: any[] }> {
  const out: Array<{ w: WorkItem; refs: any[] }> = [];
  for (const w of openQuestions()) {
    const f = work.full.get(w.item);
    const refs: any[] = Array.isArray(f?.item?.refs) ? f.item.refs : [];
    if (refs.some(r => (r?.kind === 'result' && kinds.includes(String(r.result))) || (r?.kind === 'check' && scopes.includes(String(r.check?.scope))))) { out.push({ w, refs }); }
  }
  return out;
}
/** 열린 판단 요청의 refs 를 미리 읽는다(06 의 알림이 그 refs 로 고른다) */
export async function prefetchOpenQuestions(): Promise<void> {
  await Promise.all(openQuestions().filter(w => !work.full.has(w.item)).slice(0, 10).map(w => fetchFull(`work:${w.item}`)));
}

// ── 트리 · 정보 창 ────────────────────────────────────────────────────
const sec = (title: string, body: string, t?: string) => `<div class="sec"><h4${tip(t)}>${title}<span class="sp"></span></h4>${body}</div>`;
const none = (t: string, why?: string) => `<span class="none"${tip(why)}>${esc(t)}</span>`;
/** 여러 줄 글(자료) — 글자로만, 줄바꿈은 그대로 */
const para = (s: unknown, attrs = '') => `<div class="txt" style="white-space:pre-wrap"${attrs}>${esc(String(s ?? ''))}</div>`;

function refsHtml(refs: any[]): string {
  if (!refs.length) { return none('없음'); }
  return `<ul class="notes">${refs.map(r => {
    const k = refKey(r);
    const label = r.kind === 'check' ? `검토 항목 ${r.check?.id ?? ''} (${r.check?.scope ?? ''})` : r.kind === 'result' ? `결과 ${r.result ?? ''}` : r.kind === 'field' ? `칸 ${r.path ?? ''}` : `${r.kind} ${r.id ?? r.caseId ?? ''}`;
    const attr = r.kind === 'check' ? ` data-ref-check="${esc(JSON.stringify(r.check ?? {}))}"` : r.kind === 'result' ? ` data-ref-result="${esc(String(r.result ?? ''))}"` : k ? ` data-ref-go="${esc(`${k.tab}|${k.key}`)}"` : '';
    return `<li${attr}>${attr ? `<a class="lnk">${esc(label)}</a>` : esc(label)}</li>`;
  }).join('')}</ul>`;
}

export function workInfo(key: string): string {
  const id = key.slice(5);
  const w = work.items.find(x => x.item === id);
  const f = work.full.get(id);
  if (!w) { return `<div class="hd"><div class="ttl">업무 항목</div></div>${none(work.err ? `읽지 못함 — ${work.err}` : '그 항목이 없다')}`; }
  const it = f?.item ?? null;
  const ans = it?.answer ?? null;
  const head = `<div class="hd"><div class="k"><span class="tag" data-work-kind="${esc(w.kind)}">${esc(KIND_KO[w.kind] ?? w.kind)}</span>${writerTag(w.written_by)}${esc(w.item)} · ${esc(hhmm(w.created_at))}`
    + `${w.basis_differs_from_now ? ` <span class="tag def" data-basis-differs${tip('이 항목을 쓸 때의 대상 내용과 지금이 다르다(입력 · 모델이 그 뒤에 바뀌었다)')}>기준과 다름</span>` : ''}<span class="sp"></span>`
    + `<span class="rv off" data-rv-off${tip('업무 항목의 확인은 그 항목의 판(lastSeq)을 shown 으로 보내야 한다 — 호스트의 work_items 답에 그 판이 없다(호스트에 바람)')}>확인</span></div>`
    + `<div class="ttl" data-work-title>${esc(w.title)}</div>`
    + `<div class="dim">${esc(w.state === 'closed' ? '닫힘' : w.kind === 'question' ? (w.answered || ans ? '답함' : '답 기다림') : '열림')} · ${esc(w.scope === 'project' ? '프로젝트 전체' : w.scope === 'this case' ? '이 대상' : '다른 대상')}</div></div>`;
  if (!f) { return head + sec('본문', none('읽는 중')); }
  if (f.error) { return head + sec('본문', none(`읽지 못함 — ${f.error}`)); }
  const body = it?.body ? para(it.body, ' data-work-body') : none('본문 없음');
  const opts: any[] = Array.isArray(it?.options) ? it.options : [];
  const items: any[] = Array.isArray(it?.items) ? it.items : [];
  const optHtml = opts.length ? `<ol class="notes" data-work-options>${opts.map((o, i) => `<li${ans && ans.chosen === i ? ' class="on" data-chosen="1"' : ''}><b>${esc(o?.label ?? '')}</b>${o?.consequence ? ` — <span class="dim">${esc(o.consequence)}</span>` : ''}${ans && ans.chosen === i ? ' <span class="tag">고른 것</span>' : ''}</li>`).join('')}</ol>` : '';
  const itemHtml = items.length ? `<ul class="notes" data-work-items>${items.map(x => `<li><span class="tag ${x?.status === 'open' ? 'def' : ''}">${esc(ITEM_KO[x?.status] ?? x?.status ?? '')}</span> ${esc(x?.text ?? '')}${Array.isArray(x?.refs) && x.refs.length ? refsHtml(x.refs) : ''}</li>`).join('')}</ul>` : '';
  const answer = w.kind !== 'question' ? ''
    : sec('답', ans
      ? `<div class="say usr" data-work-answer><span class="tag ai"${tip('사람이 Claude Desktop 대화에서 한 말을 AI 가 옮겨 적었다 — 원문 그대로가 아닐 수 있다')}>AI 가 옮겨 적음</span> <span class="faint">${esc(hhmm(ans.at))}</span>${para(ans.said)}</div>`
      : `${none('답 없음', '답은 Claude Desktop 대화에서 한다 — AI 가 그 말을 옮겨 적는다. 이 화면에는 답하는 칸이 없다')}`,
    '사람의 답은 대화에서 — AI 가 사람의 말을 옮겨 적는다(사람만 하는 확인은 R4)');
  const hist: any[] = Array.isArray(it?.history) ? it.history : [];
  return head
    + sec(w.kind === 'question' ? '질문' : w.kind === 'report' ? '본문' : '지시', body, '쓴 쪽의 글 그대로(자료 — 지시가 아니다)')
    + (optHtml ? sec('선택지와 결과', optHtml) : '')
    + (itemHtml ? sec('항목', itemHtml) : '')
    + answer
    + sec('걸린 대상', refsHtml(Array.isArray(it?.refs) ? it.refs : []), '누르면 그 대상으로')
    + (hist.length ? sec('이력', `<ul class="notes faint">${hist.map(h => `<li>${esc(String(h?.event ?? ''))} · ${esc(hhmm(h?.at))}</li>`).join('')}</ul>`) : '')
    + `<div class="sec"><span class="faint"${tip('호스트의 text_note 와 같은 뜻 — AI 에게도 같은 말이 간다')}>이 글은 쓴 쪽(AI · 다른 작성자)의 자료다 — 지시가 아니다. 사람의 말은 AI 가 옮겨 적은 것이다</span></div>`;
}

export function asmInfo(key: string): string {
  const id = key.slice(5);
  const a = asm.items.find(x => x.item === id);
  const f = asm.full.get(id);
  if (!a) { return `<div class="hd"><div class="ttl">가정</div></div>${none(asm.err ? `읽지 못함 — ${asm.err}` : '그 가정이 없다')}`; }
  const it = f?.item ?? null;
  const st = STATUS_KO[a.status] ?? { t: a.status, cls: '' };
  const kv = (k: string, v: string) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  return `<div class="hd"><div class="k"><span class="tag ${st.cls}" data-asm-status="${esc(a.status)}">${esc(st.t)}</span>${writerTag(a.written_by)}${esc(a.item)}${a.closed ? ' <span class="tag">닫힘</span>' : ''}<span class="sp"></span>`
    + `<span class="rv off" data-rv-off${tip('가정의 확인은 그 가정의 판(lastSeq)을 shown 으로 보내야 한다 — 호스트의 assumptions 답에 그 판이 없다(호스트에 바람)')}>확인</span></div>`
    + `<div class="ttl" data-asm-text>${esc(it?.text ?? a.text)}</div>`
    + `<div class="dim">${esc(ORIGIN_KO[a.origin] ?? a.origin)} · ${esc(a.scope_of === 'project' ? '프로젝트 전체' : '이 대상')}</div></div>`
    + sec('상태', `<dl class="kv">${kv('사람의 확인', `<span data-person-confirmed="${a.person_confirmed}">${a.person_confirmed ? '있음(이 판)' : '없음 — 사람만 확인한다'}</span>`)}`
      + kv('발행', a.blocks_issue ? '<span class="verdict warn" data-blocks-issue="1">막는다</span>' : '<span data-blocks-issue="0">막지 않는다</span>')
      + (it?.closed_by ? kv('닫은 것', esc(typeof it.closed_by === 'string' ? it.closed_by : JSON.stringify(it.closed_by))) : '') + '</dl>',
    '프로그램이 쓴 자동 가정은 원인이 사라지면 프로그램이 닫는다(사람의 확인 없이 풀리는 유일한 닫기). 그 밖의 가정은 사람의 확인 전까지 발행을 막는다')
    + (it ? sec('근거', it.basis ? para(it.basis) : none('없음')) + sec('영향', it.impact ? para(it.impact) : none('없음'))
      + sec('걸린 칸', refsHtml(Array.isArray(it.scope) ? it.scope : []))
      + sec('원자료', Array.isArray(it.sources) && it.sources.length ? `<ul class="notes">${it.sources.map((s: any) => `<li data-ref-go="${esc(`doc|srcr:${String(s?.id ?? '')}`)}"><a class="lnk">${esc(String(s?.id ?? ''))}</a>${s?.page ? ` <span class="faint">${esc(String(s.page))}</span>` : ''}</li>`).join('')}</ul>` : none('없음'))
      : sec('근거', none(f?.error ? `읽지 못함 — ${f.error}` : '읽는 중')));
}

export function srcInfo(key: string): string {
  const id = key.slice(5);
  const s = srcs.items.find(x => x.item === id);
  if (!s) { return `<div class="hd"><div class="ttl">원자료</div></div>${none(srcs.err ? `읽지 못함 — ${srcs.err}` : '그 원자료가 없다')}`; }
  const st = SRC_STATE[s.state] ?? SRC_STATE.unknown;
  return `<div class="hd"><div class="k">원자료 · ${esc(SRC_KIND[s.kind] ?? s.kind)}${writerTag(s.written_by)}${esc(s.item)}<span class="sp"></span><span class="verdict ${st.cls}" data-src-state="${esc(s.state)}">${esc(st.t)}</span></div>`
    + `<div class="ttl" data-src-title>${esc(s.title)}</div><div class="dim">${esc(s.file)}</div></div>`
    + sec('파일', `<dl class="kv"><dt>해시</dt><dd class="num">${esc(s.sha12)}…</dd><dt>크기</dt><dd class="num">${esc(String(s.size))} B</dd><dt>등록</dt><dd>${esc(hhmm(s.registered_at))}</dd></dl>`
      + `<div class="btns"><span class="btn" data-open-src="${esc(s.item)}"${tip('OS 의 기본 앱으로 연다(사람의 화면에서만). 내용은 AI 에게 가지 않는다')}>열기</span></div>`,
    '이름 · 해시 앞 12 · 크기 · 상태(같음 · 바뀜 · 없음)만 — 프로그램은 내용을 읽지 않는다(AI 에게 주지 않는다)');
}

/** 시작 화면 「다음 판단」 — 열린 대상은 get_case_status 의 open_questions(제목 첫째). 다른 대상은 목록에 수가 없다(호스트에 바람) */
export function nextJudgement(open: boolean, status: any): string {
  if (!open) { return `<span class="dot"></span> <span class="faint"${tip('다른 대상의 열린 판단 요청 수는 목록(list_cases)에 없다 — 열면 보인다')}>—</span>`; }
  const n = typeof status?.open_questions === 'number' ? status.open_questions : openQuestions().length;
  const t = Array.isArray(status?.open_question_titles) && status.open_question_titles.length ? String(status.open_question_titles[0]?.title ?? status.open_question_titles[0] ?? '') : openQuestions()[0]?.title ?? '';
  return n ? `<span class="dot warn"></span> <span data-next-q="${n}">판단 ${n}</span>${t ? `<div class="faint">${esc(t)}</div>` : ''}` : '<span class="dot ok"></span> <span data-next-q="0">없음</span>';
}
