/**
 * R2-3 — 변경 묶음이 화면에(기록 설계 §5.1 · §5.4 · 템플릿 07 · 01 – 06 · 09). 화면은 짓지 않는다: 줄 · 제목 · 전 → 후 글은 호스트의 것.
 *
 *  - 업무 › 변경: 호스트 동작 `list_changes {detail: 'fields'}` — 최신부터 `{id, at, by {kind, client}, trigger, title, reason?, work?, source?,
 *    fields, invalidated?, field_changes?}`. 제목 · 칸 글(「두께 t 2 → 2.3 mm」)은 프로그램이 칸에서 지은 것(SI). `reason` 은 AI 가 준 글 —
 *    자료로만 보인다(지시가 아니다).
 *  - 출처 꼬리표: 입력 키는 `get_case_inputs.last_change[키] {by, at, from, to, change}`(값은 US — 이 화면의 하나뿐인 변환 units.caseSI 로 SI),
 *    모델 칸(치수 · 재료 · 경계조건 …)은 `list_changes` 의 칸 글 가운데 그 칸의 이름(제품의 `fieldLabel` — 호스트와 같은 함수)으로 시작하는 마지막 것.
 *  - 기준점(마지막 실행 — get_full_state.results 의 가장 늦은 때) 뒤의 변경에 점.
 */
// 칸의 이름 — 호스트가 제목 · 칸 글을 지을 때 쓰는 그 함수(src/records/changeText.ts 의 컴파일본 — 그 소스의 형은 노드 형을 끌고 온다)
// @ts-expect-error — CommonJS 모듈, 형 정보 없음
import * as CT from '../../../out/records/changeText.js';
const fieldLabel = ((CT as { fieldLabel?: unknown }).fieldLabel ?? (CT as { default?: { fieldLabel?: unknown } }).default?.fieldLabel) as (path: string) => string;
import { mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm, sigText } from './format';
import { fieldOf, OPTION_KO } from './caseFields';
import { state } from './store';
import { caseSI } from './units';

export interface Change {
  id: string; at: string; by: { kind: string; client?: string }; trigger: string | null; title: string;
  reason?: string; work?: string; source?: string; fields: number; invalidated?: string[]; field_changes?: string[]; record_status?: string;
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

export const BY_KO: Record<string, string> = { ai: 'AI', person: '사용자', program: '프로그램', external: '밖에서' };
const BY_TIP: Record<string, string> = {
  ai: 'AI 가 MCP 도구로 바꿨다', person: '사람이 바꿨다(편집 상태 · 화면)', program: '프로그램이 바꿨다(사람 · AI 의 요청 밖)', external: '프로그램 밖에서 파일이 바뀌었다(마지막 저장과 연 파일의 차이)',
};
export const byTag = (kind: string, extraTip = ''): string => `<span class="tag ${kind === 'ai' ? 'ai' : kind === 'external' ? 'def' : ''}" data-by="${esc(kind)}"${tip(`${BY_TIP[kind] ?? kind}${extraTip ? ` — ${extraTip}` : ''}`)}>${esc(BY_KO[kind] ?? kind)}</span>`;

/** 기준점 — 마지막 실행(호스트의 남은 결과 가운데 가장 늦은 때). 그 뒤의 변경에 점 */
export function basePointAt(): string | null {
  const res = state.full?.results ?? {};
  const ats = Object.values(res).map((x: any) => (x && typeof x.at === 'string' ? x.at : null)).filter((x): x is string => !!x).sort();
  return ats.length ? ats[ats.length - 1] : null;
}
export const afterBase = (c: Change): boolean => { const b = basePointAt(); return !b || c.at > b; };
export const changeOf = (id: string): Change | undefined => chg.list.find(c => c.id === id);

/** 모델 칸(경로 `model.…`)의 마지막 변경 — 그 칸의 이름(제품의 fieldLabel)으로 시작하는 칸 글 */
export function modelChange(path: string): { c: Change; text: string } | null {
  const label = fieldLabel(path);
  for (const c of chg.list) {
    const f = (c.field_changes ?? []).find(x => typeof x === 'string' && x.startsWith(`${label} `));
    if (f) { return { c, text: f.slice(label.length + 1) }; }
  }
  return null;
}

/** 모델 칸의 꼬리표 — 기록에 있으면 「AI · 2 → 2.3 mm · 10:12」, 없으면 fallback(기본값 · 지정) */
export function modelTag(path: string, fallback: string): string {
  const m = modelChange(path);
  if (!m) { return fallback; }
  const why = m.c.reason ? `이유: ${m.c.reason}` : '';
  return `${byTag(m.c.by.kind, `${hhmm(m.c.at)} ${m.text}${why ? ` · ${why}` : ''} · 누르면 업무 › 변경의 그 줄${chg.persisted ? '' : ' · 이 세션 · 저장되지 않음'}`)}`
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
