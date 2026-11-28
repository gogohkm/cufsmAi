/**
 * R2-3 — 변경 묶음이 화면에(기록 설계 §5.1 · §5.4 · 템플릿 07 · 01 – 06 · 09). 화면은 짓지 않는다: 줄 · 제목 · 전 → 후 글은 호스트의 것.
 *
 *  - 업무 › 변경: 호스트 동작 `list_changes {detail: 'fields'}` — 최신부터 `{id, at, by {kind, client}, trigger, title, reason?, work?, source?,
 *    fields, invalidated?, field_changes?, geometry?}`. 칸은 구조 `{path, key, label_ko, from, to, unit, quantity, text, summary?}`(373d81f — 수는 요청한
 *    단위 SI), `geometry {nodes, elements: {added, removed, changed, count}, element_ids, node_ids, explained_by_dimensions}`. 제목 · 칸 글은 프로그램이
 *    지은 것. `reason` 은 AI 가 준 글 — 자료로만 보인다(지시가 아니다).
 *  - 출처 꼬리표: 입력 키는 `get_case_inputs.last_change[키] {by, at, from, to, change}`(값은 US — 이 화면의 하나뿐인 변환 units.caseSI 로 SI),
 *    모델 칸(치수 · 재료 · 경계조건 …)은 `list_changes` 의 칸 가운데 그 `path` 인 마지막 것(이름 글로 맞대지 않는다).
 *  - 기준점(마지막 실행 — get_full_state.results 의 가장 늦은 때) 뒤의 변경에 점.
 */
import { mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm, sigText } from './format';
import { fieldOf, OPTION_KO } from './caseFields';
import { state } from './store';
import { caseSI } from './units';
import { rec } from './records';

/** 칸 하나의 바뀜(호스트 changeText.fieldRecord) — 수는 요청한 단위(SI), unit 은 그 단위 글자, quantity 는 단위 종류 */
export interface FieldRec {
  path: string; key: string; label_ko: string; text: string; from?: unknown; to?: unknown; unit?: string | null; quantity?: string | null;
  summary?: { count: { from: number; to: number }; changed: number; added: number; removed: number; columns?: string[]; ids?: { changed: number[]; added: number[]; removed: number[] } };
  odd?: number;
}
export interface Geometry {
  nodes?: { added: number; removed: number; changed: number; count: number } | null; elements?: { added: number; removed: number; changed: number; count: number } | null;
  element_ids?: { changed: number[]; added: number[]; removed: number[] }; node_ids?: { changed: number[]; added: number[]; removed: number[] }; explained_by_dimensions?: boolean;
}
export interface Change {
  id: string; at: string; by: { kind: string; client?: string }; trigger: string | null; title: string;
  reason?: string; work?: string; source?: string; fields: number; invalidated?: string[]; field_changes?: FieldRec[]; geometry?: Geometry | null; record_status?: string;
  /** 같은 요청이 남긴 실행의 id(있을 때만 — history 의 run 과 같은 id). 있으면 그 실행의 머리줄 아래에 둔다 */
  runs?: string[];
}
/** 칸 값 하나의 글(호스트가 준 수 그대로 — 유효숫자 6 에서 끝의 0 을 지운 꼴, 빈 칸은 「(빈 칸)」) */
export function valText(v: unknown): string {
  if (v === null || v === undefined || v === '') { return '(빈 칸)'; }
  if (typeof v === 'boolean') { return v ? '켬' : '끔'; }
  if (typeof v === 'number') { return Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v); }
  if (Array.isArray(v)) { return v.length <= 4 ? v.map(valText).join(', ') : `${v.length}개`; }
  return String(v);
}
/**
 * 2026-11-28 결정 S1: 단면 목록의 단면 하나를 더하거나 지운 칸(`case.sections[S2]` — 전 · 후 값은 단면 id 이거나 null)은 전 → 후 가 아니라
 * 호스트의 글(「단면 S2 추가」 · 「단면 S2 삭제」)로 읽는다
 */
export const wholeSection = (f: FieldRec): boolean => /^case\.sections\[S\d+\]$/.test(String(f?.path ?? ''));
/** 칸 하나 → 「전 → 후 단위」(요약 칸 · 이름 꼴 밖은 호스트의 글) */
export function fromTo(f: FieldRec): string {
  if (f.summary || f.odd !== undefined || wholeSection(f) || !('from' in f || 'to' in f)) { return f.text; }
  return `${valText(f.from)} → ${valText(f.to)}${f.unit && typeof f.to === 'number' ? ` ${f.unit}` : ''}`;
}
export const chg: { list: Change[]; persisted: boolean; total: number; err?: string; base: string | null; baseFor: string | null } = { list: [], persisted: false, total: 0, base: null, baseFor: null };

/** 호스트에서 다시 읽는다(새로 고칠 때마다 — 묶음은 AI 요청 하나 · 편집 한 번 · 조용한 2 초마다 생긴다) */
export async function loadChanges(): Promise<void> {
  const r = await mcp<any>('list_changes', { detail: 'fields', limit: 50 });
  if (!r || r.error) { chg.err = String(r?.error ?? '변경 목록을 읽지 못함'); return; }
  chg.err = undefined;
  chg.list = Array.isArray(r.changes) ? r.changes.filter((c: any) => c && typeof c.id === 'string') : [];
  chg.persisted = r.persisted === true;
  chg.total = typeof r.total === 'number' ? r.total : chg.list.length;
}

/** 행위자 넷(D4 · D5) — 사람 · AI · 프로그램 · 파일. 호스트의 `external`(옛 줄)은 파일로 읽는다 */
export type Actor = 'person' | 'ai' | 'program' | 'file';
export const BY_KO: Record<string, string> = { ai: 'AI', person: '사람', program: '프로그램', external: '파일', file: '파일' };
const BY_TIP: Record<string, string> = {
  ai: 'AI 가 MCP 도구로 바꿨다', person: '사람이 바꿨다(편집 상태 · 화면)', program: '프로그램이 바꿨다(사람 · AI 의 요청 밖 — 화면 연동 · 단위 바꿈 · 기본값)',
  file: '파일에서 왔다(열기 · 가져오기 · 프로그램 밖에서 바뀐 파일)', external: '파일에서 왔다(열기 · 가져오기 · 프로그램 밖에서 바뀐 파일)',
};
/**
 * 화면 연동만으로 생긴 줄 — 호스트가 그 줄의 trigger 에 `mirror`(다른 칸을 따라 바뀜) · `unit-toggle`(단위 바꿈) · `default`(기본값 채움)를 적는다.
 * 옛 호스트는 by.kind 를 person 으로, 새 호스트(D4)는 program 으로 적는다 — 둘 다 「프로그램 · 화면 연동」 이다(사람이 친 것이 아니다)
 */
export const LINK_KO: Record<string, string> = { mirror: '화면 연동', 'unit-toggle': '단위 바꿈', default: '기본값 채움' };
export const linkOf = (c: Change): string | null => ((c.by.kind === 'person' || c.by.kind === 'program') && typeof c.trigger === 'string' && LINK_KO[c.trigger]) || null;
/** 그 줄의 행위자(넷 가운데 하나) */
export const actorOf = (c: Change): Actor => (linkOf(c) || c.by.kind === 'program' ? 'program' : c.by.kind === 'ai' ? 'ai' : c.by.kind === 'external' || c.by.kind === 'file' ? 'file' : 'person');
/** 그 줄의 「누가」 글(사람 · AI · 프로그램 · 파일 · 프로그램 · 화면 연동) */
export const whoText = (c: Change): string => (linkOf(c) ? `프로그램 · ${linkOf(c)}` : BY_KO[c.by.kind] ?? c.by.kind);
export const LINK_TIP = '사람이 친 것이 아니다 — 설계 화면이 다른 칸(또는 단위 · 기본값)을 따라 이 칸을 맞췄다';
const ACTOR_OF_KIND = (kind: string): Actor => (kind === 'ai' ? 'ai' : kind === 'program' ? 'program' : kind === 'external' || kind === 'file' ? 'file' : 'person');
/** 행위자 배지 — 사람 초록 · AI 파랑 · 프로그램 회색 · 파일 보라(D5). data-by 는 호스트의 kind 그대로 */
export const byTag = (kind: string, extraTip = '', actor: Actor = ACTOR_OF_KIND(kind)): string => `<span class="tag by-${actor}" data-by="${esc(kind)}" data-actor="${actor}"${tip(`${BY_TIP[actor] ?? kind}${extraTip ? ` — ${extraTip}` : ''}`)}>${esc(BY_KO[actor] ?? kind)}</span>`;
/** 변경 묶음 하나의 배지(연동 줄은 프로그램) */
export const actorTag = (c: Change, extraTip = ''): string => byTag(c.by.kind, extraTip, actorOf(c));

// ── 기록 — 실행(계산 #k)으로 접기(통일안 6.2) ─────────────────────────
/** get_case_status detail runs 의 history 한 줄. `no`(대상 안의 실행 차례) · `auto`(다른 계산이 자동으로 만든 것)는 새 호스트만 준다 */
export interface Hist { run: string; kind: string; at: string; by?: string; client?: string | null; status?: string; pass?: boolean | null; max_ratio?: number | null; governing?: { id?: string; ratio?: number; verdict?: string } | null; props?: any; no?: number; auto?: boolean }
/** 기록의 머리줄 하나 = 실행 하나(E6 — 접지 않는다). runs 는 늘 [head](옛 모양을 쓰는 곳을 위해 둔다). changes 가 비면 「입력 변경 없음」 */
export interface RunGroup { key: string; runs: Hist[]; head: Hist; verdict: Hist | null; changes: Change[] }
export interface Timeline { hasRuns: boolean; after: Change[]; groups: RunGroup[]; before: Change[] }
/** 실행 이력(새 것부터 20 — 호스트). 프로젝트 밖은 null */
export function history(): Hist[] | null {
  const h = rec.status?.history as unknown;
  return Array.isArray(h) ? h.filter((x: any) => x && typeof x.at === 'string') : null;
}
/** 머리줄이 되는 실행 — 자동 실행 · 설계용 좌굴값(design_dsm)은 머리줄이 아니다 */
const shownRun = (x: Hist): boolean => x.auto !== true && x.kind !== 'design_dsm';
const byAt = (a: Hist, b: Hist): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
/**
 * 기록의 묶음(E6) — 실행 하나 = 머리줄 하나(자동 실행 · 설계용 좌굴값은 빼고), 잇단 실행을 접지 않는다. 묶음은 그것이 처음 들어간 실행의 머리줄 아래 —
 * 호스트의 work_log(StcfsdPanel._workTimeline)와 같은 연결: 실행이 실린 묶음(runs)은 그 가운데 첫 실행, 시각으로 놓이는 묶음은 그 뒤의 첫 실행
 * (같은 때면 실행이 먼저 — 그 묶음은 다음 실행). 첫 실행이 머리줄이 아닌 실행(자동 · 설계용 좌굴값)이면 그 때를 품은 머리줄(그 뒤의 첫 머리줄).
 * 그래서 다시 계산해도 묶음이 최신 계산 아래로 옮겨 가지 않는다. 묶음이 없는 실행은 「계산 #n (입력 변경 없음)」 한 줄.
 * 실행 이력이 없으면(프로젝트 밖) 기준점(basePointAt) 앞 · 뒤 둘로만
 */
export function timeline(): Timeline {
  const h = history();
  const all = (h ?? []).slice().sort(byAt);
  const runs = all.filter(shownRun);
  // 같은 요청이 남긴 실행이 있는 묶음(runs — 설계 도구는 계산이 먼저, 입력 확정이 뒤)은 시각이 아니라 그 실행으로 둔다
  const linked = (c: Change): boolean => Array.isArray(c.runs) && c.runs.length > 0;
  const timed = chg.list.filter(c => !linked(c));
  if (!runs.length) {
    const b = basePointAt();
    return { hasRuns: false, after: timed.filter(c => !b || c.at > b), groups: [], before: chg.list.filter(c => linked(c) || (!!b && c.at <= b)) };
  }
  const first = runs[0].at, last = runs[runs.length - 1].at;
  // 이력이 다 있으면(20 보다 적음 · 첫 실행이 #1) 첫 계산 앞의 묶음은 첫 계산에 들어간 것이다. 잘렸으면 「계산 기록 앞」
  const complete = (h ?? []).length < 20 || all[0]?.no === 1 || runs[0].no === 1;
  // 오래된 것부터 — 실행 r 의 묶음 = 앞 머리줄의 때 ≤ at < r 의 때(호스트와 같이 같은 때면 실행이 먼저)
  const groups: RunGroup[] = runs.map((r, i) => {
    const lo = i === 0 ? (complete ? '' : null) : runs[i - 1].at;
    const verdict = typeof r.max_ratio === 'number' || typeof r.pass === 'boolean' ? r : null;
    return { key: `log:run:${String(r.run ?? r.at).replace(/[#|]/g, '')}`, runs: [r], head: r, verdict, changes: lo === null ? [] : timed.filter(c => c.at >= lo && c.at < r.at) };
  });
  const before = complete ? [] : timed.filter(c => c.at < first);
  const after = timed.filter(c => c.at >= last);
  // 실행이 실린 묶음 — 그 첫 실행의 머리줄. 머리줄이 아닌 실행이면 그 때를 품은 머리줄(그 뒤의 첫 것 — 없으면 지난 계산 뒤), 이력에 없으면(20 보다 오래됨) 「계산 기록 앞」
  for (const c of chg.list.filter(linked)) {
    const r = anchorRun(c);
    const g = r ? groups.find(x => x.head.run === r.run) ?? groups.find(x => x.head.at >= r.at) ?? null : null;
    if (g) { g.changes.push(c); } else if (r) { after.push(c); } else { before.push(c); }
  }
  const byNew = (a: Change, b: Change) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
  groups.forEach(g => g.changes.sort(byNew));
  before.sort(byNew);
  after.sort(byNew);
  return { hasRuns: true, after, groups: groups.reverse(), before };
}
/** 묶음에 실린 실행(이력에 있는 것만) — 오래된 것부터 */
function ownRuns(c: Change): Hist[] {
  if (!Array.isArray(c.runs) || !c.runs.length) { return []; }
  return (history() ?? []).filter(x => c.runs!.includes(x.run)).sort(byAt);
}
/** 묶음이 처음 들어간 실행 — 실린 실행 가운데 첫 것(호스트 work_log 의 연결과 같다). 없으면 null */
export function anchorRun(c: Change): Hist | null {
  return ownRuns(c)[0] ?? null;
}
/**
 * 묶음의 판정 변화 — 실행이 실린 묶음은 「그 실행 앞의 마지막 판정 실행 → 실린 실행 가운데 첫 판정 실행(없으면 그 뒤의 첫 판정 실행)」
 * (호스트 work_log 의 verdict_delta 와 같은 쪽), 아니면 시각으로(runsAround)
 */
export function aroundOf(c: Change): { before: Hist | null; after: Hist | null; anyAfter: boolean } {
  if (Array.isArray(c.runs) && c.runs.length) {
    const own = ownRuns(c);
    const r = own[0];
    if (!r) { return { before: null, after: null, anyAfter: true }; }
    const hist = history() ?? [];
    const rated = (x: Hist) => typeof x.max_ratio === 'number';
    return {
      before: hist.find(x => x.at < r.at && !c.runs!.includes(x.run) && rated(x)) ?? null,
      after: own.find(rated) ?? [...hist].reverse().find(x => x.at > r.at && rated(x)) ?? null,
      anyAfter: true,
    };
  }
  return runsAround(c.at);
}
/** 머리줄의 이름 — 「계산 #no」, 번호가 없으면(옛 호스트) 「종류 · 시각」 */
export const runName = (r: Hist): string => (typeof r.no === 'number' ? `계산 #${r.no}` : `${KIND_RESULT_KO[r.kind] ?? r.kind} · ${hhmm(r.at)}`);
/** 기록 머리줄의 이름 — 묶음이 없는 실행은 「계산 #n (입력 변경 없음)」 */
export const groupName = (g: RunGroup): string => `${runName(g.head)}${g.changes.length ? '' : ' (입력 변경 없음)'}`;
/** 다시 계산이 필요한 변경 — 지난 계산 뒤, 프로그램의 연동 줄은 세지 않는다 */
export const pendingChanges = (): Change[] => timeline().after.filter(c => actorOf(c) !== 'program');
/** 그 때 앞의 마지막 실행 · 뒤의 첫 실행(최대 판정비가 있는 것 — 호스트의 실행 이력, 새 것부터). until 이 있으면 그 앞까지 */
export function runsAround(at: string, until?: string): { before: Hist | null; after: Hist | null; anyAfter: boolean } {
  const hist = history() ?? [];
  return {
    before: hist.find(x => x.at < at && typeof x.max_ratio === 'number') ?? null,
    after: [...hist].reverse().find(x => x.at > at && (!until || x.at < until) && typeof x.max_ratio === 'number') ?? null,
    anyAfter: hist.some(x => x.at > at && x.auto !== true && x.kind !== 'design_dsm'),
  };
}

/** 기준점 — 마지막 실행(호스트의 남은 결과 가운데 가장 늦은 때). 그 뒤의 변경에 점 */
export function basePointAt(): string | null {
  const res = state.full?.results ?? {};
  const ats = Object.values(res).map((x: any) => (x && typeof x.at === 'string' ? x.at : null)).filter((x): x is string => !!x).sort();
  return ats.length ? ats[ats.length - 1] : null;
}
export const afterBase = (c: Change): boolean => { const b = basePointAt(); return !b || c.at > b; };
export const changeOf = (id: string): Change | undefined => chg.list.find(c => c.id === id);

/** 모델 칸(경로 `model.…`)의 마지막 변경 — 칸의 path 로(이름 글로 맞대지 않는다) */
export function modelChange(path: string): { c: Change; text: string } | null {
  for (const c of chg.list) {
    const f = (c.field_changes ?? []).find(x => x && typeof x === 'object' && x.path === path);
    if (f) { return { c, text: fromTo(f) }; }
  }
  return null;
}

/** 모델 칸의 꼬리표 — 기록에 있으면 「AI · 2 → 2.3 mm · 10:12」, 없으면 fallback(기본값 · 지정) */
export function modelTag(path: string, fallback: string): string {
  const m = modelChange(path);
  if (!m) { return fallback; }
  const why = m.c.reason ? `이유: ${m.c.reason}` : '';
  return `${actorTag(m.c, `${hhmm(m.c.at)} ${m.text}${why ? ` · ${why}` : ''} · 누르면 업무 › 기록의 그 줄${chg.persisted ? '' : ' · 이 세션 · 저장되지 않음'}`)}`
    + `<span class="why" data-last-change="${esc(m.c.id)}" data-chg-go="${esc(m.c.id)}">${esc(m.text)} · ${esc(hhmm(m.c.at))}</span>`;
}

/** 입력 값 하나의 글(SI — 이 화면의 변환) */
function inputText(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') { return '빈칸'; }
  if (typeof v === 'boolean') { return v ? '켬' : '끔'; }
  if (typeof v === 'string') { return OPTION_KO[v] ?? v; }
  const { v: x } = caseSI(v, fieldOf(key)?.kind ?? null);
  if (Array.isArray(x)) { return x.map(y => (typeof y === 'number' ? sigText(y, 4) : String(y))).join(', '); }
  return typeof x === 'number' ? sigText(x, 4) : String(x);
}

/** 입력 키의 마지막 변경(get_case_inputs.last_change) — 꼬리표 옆 why: 「AI · 1.2 → 1.3 · 10:12」. 기록이 없으면 '' */
export function inputWhy(key: string): string {
  const lc = state.caseIn?.last_change?.[key];
  if (!lc || typeof lc !== 'object') { return ''; }
  const by = BY_KO[String(lc.by)] ?? String(lc.by ?? '');
  const t = `${inputText(key, lc.from)} → ${inputText(key, lc.to)}`;
  return `<span class="why" data-last-change="${esc(String(lc.change ?? ''))}" data-chg-go="${esc(String(lc.change ?? ''))}"${tip(`${by} · ${hhmm(lc.at)} · ${t}${lc.reason ? ` · 이유: ${String(lc.reason)}` : ''} · 누르면 업무 › 변경의 그 줄`)}>${esc(by)} · ${esc(t)} · ${esc(hhmm(lc.at))}</span>`;
}

/** 결과 종류 → 이름 */
export const KIND_RESULT_KO: Record<string, string> = {
  buckling_analysis: '좌굴 해석', design_dsm: '설계용 좌굴값', load_analysis: '하중 해석', member_design: '부재 검토', lap: '랩 접합', connection: '접합부',
  validation: '점검', signature_ss: '서명곡선',
};

/** 06 의 낡음 풍선 — 그 결과를 무효로 만든 가장 늦은 변경의 때 · 칸 글(전 → 후). 없으면 null */
export function staleCause(kinds: string[]): { c: Change; text: string } | null {
  const c = chg.list.find(x => (x.invalidated ?? []).some(k => kinds.includes(k)));
  if (!c) { return null; }
  // 제목(프로그램이 칸에서 지은 것 — 템플릿 치수로 설명되는 절점 · 요소 요약은 빼고 「외 n」)
  return { c, text: `${hhmm(c.at)} ${c.title} 뒤에 다시 돌리지 않았다` };
}

/** 비교 기준 — 고른 변경의 바로 앞(기본) 또는 사람이 고른 변경. null = 목록의 처음부터 */
export function baseOf(sel: Change): Change | null {
  if (chg.base && chg.baseFor === sel.id) { return changeOf(chg.base) ?? null; }
  const i = chg.list.findIndex(c => c.id === sel.id);
  return i >= 0 && i + 1 < chg.list.length ? chg.list[i + 1] : null;
}
/** 기준 뒤 · 지금까지의 변경(최신부터) */
export function sinceBase(sel: Change): Change[] {
  const b = baseOf(sel);
  return b ? chg.list.filter(c => c.at > b.at || (c.at === b.at && chg.list.indexOf(c) < chg.list.indexOf(b))) : chg.list.slice();
}
