/**
 * R4-3 화면 — 대안(기록 설계 §5.5 · 보기 계약 4h). 호스트 동작 `alternatives`(`op: list | keep | compare | open | rename | drop | undrop` — AI 와 같은 동작,
 * 화면의 중계는 사람의 문맥). 비교는 호스트가 검토 열쇠로 맞댄 것(`compare.rows` — 지금 | 대안 의 판정비 · 판정)을 그대로 놓는다 — 화면은 순위를 짓지 않는다
 * (「가장 얇은」 · 「무게」는 AI 의 이유 글이다, D12). 라벨은 AI 가 쓴 글(자료).
 */
import { mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm, ratioText, sigText } from './format';
/** 판정비 글(기록의 값 — 화면의 수 대조 data-src 를 달지 않는다) */
const ratio = (v: number, ng: boolean): string => `<span class="num${ng ? ' ng' : ''}" data-ratio="${ng ? 'ng' : 'ok'}">${ratioText(v, ng)}</span>`;
import { allRows, state } from './store';
import { si } from './units';

export interface Alt { item: string; label: string; hidden?: boolean; created_at: string; is_now: boolean; runs: string[]; max_ratio: number | null; pass: boolean | null; A: number | null;
  differs_from_now?: { fields: number; first: string[] } | null; copy?: string; written_by: string }
export interface CmpRow { key: string; scope: string; id: string; location?: unknown; now: { ratio: number | null; verdict: string | null } | null; alt: { ratio: number | null; verdict: string | null } | null }
export const alts: { items: Alt[]; err?: string; cmp: Map<string, any>; showHidden: boolean; draft: Record<string, string> } = { items: [], cmp: new Map(), showHidden: false, draft: {} };

export async function loadAlts(): Promise<void> {
  if (!state.full?.project?.case) { alts.items = []; alts.cmp.clear(); return; }
  const r = await mcp<any>('alternatives', { op: 'list', include_hidden: true });
  if (!r || r.error) { alts.err = String(r?.error ?? '읽지 못함'); alts.items = []; return; }
  alts.err = undefined;
  alts.items = Array.isArray(r.items) ? r.items : [];
  alts.cmp.clear();
}
/** 대안 하나의 비교(전부 — detail all). 한 번 읽어 둔다 */
export async function compareOf(item: string): Promise<any> {
  if (!alts.cmp.has(item)) { alts.cmp.set(item, await mcp<any>('alternatives', { op: 'compare', item, detail: 'all' })); }
  return alts.cmp.get(item);
}
export const visibleAlts = (): Alt[] => alts.items.filter(a => alts.showHidden || !a.hidden);
export async function altAction(op: 'keep' | 'open' | 'rename' | 'drop' | 'undrop', args: Record<string, unknown> = {}): Promise<any> {
  return mcp<any>('alternatives', { op, ...args });
}

const vCls = (v: string | null | undefined) => (v === 'fail' ? 'ng' : v === 'pass' ? 'ok' : 'un');
const vKo = (v: string | null | undefined) => (v === 'fail' ? 'NG' : v === 'pass' ? 'OK' : v === 'not_applicable' ? '해당 없음' : v ? '미검토' : '없음');
const cell = (x: { ratio: number | null; verdict: string | null } | null) => (!x ? '<span class="faint">없음</span>'
  : `${typeof x.ratio === 'number' ? ratio(x.ratio, x.verdict === 'fail') : '<span class="faint">—</span>'} <span class="verdict ${vCls(x.verdict)}" style="font-weight:400">${vKo(x.verdict)}</span>`);

/** 지키기 · 이름 바꾸기 · 숨기기는 호스트의 행위자 표(records/policy.ts alternatives — ai 만)가 사람에게 열지 않는다 — 꺼 두고 까닭 */
const PERSON_NO = '호스트의 기록 규칙이 대안의 지키기 · 이름 바꾸기 · 숨기기를 AI 에게만 연다(사람의 화면에서는 아직 못 한다 — 호스트에 바람). Claude 에게 말하면 AI 가 한다';

/** 열쇠의 사람 글 — 범위 · 위치 · id */
export function rowLabel(r: CmpRow): string {
  const loc = r.location && typeof r.location === 'object' ? r.location as Record<string, unknown> : null;
  const where = loc ? [loc.region ? `구간 ${String(loc.region)}` : '', loc.check_point ? String(loc.check_point) : '', loc.segment ? String(loc.segment) : ''].filter(Boolean).join(' · ') : '';
  // 검토 항목의 이름(지금 결과의 name_ko — 같은 id) · 없으면 id
  const nm = allRows().find(x => x.id === r.id)?.name ?? r.id;
  return `${where ? `${where} · ` : ''}${nm}`;
}

/** 대안 여럿을 나란히 — 열쇠마다 지금 | 대안 1 | 대안 2 …(호스트의 compare 의 값 그대로) */
export function sideBySide(list: Alt[]): string {
  const cmps = list.map(a => alts.cmp.get(a.item));
  if (cmps.some(c => !c)) { return '<p class="dim">비교를 읽는 중</p>'; }
  const keys: string[] = [];
  const label = new Map<string, string>();
  const nowOf = new Map<string, CmpRow['now']>();
  cmps.forEach(c => (Array.isArray(c?.rows) ? c.rows : []).forEach((r: CmpRow) => { if (!label.has(r.key)) { keys.push(r.key); label.set(r.key, rowLabel(r)); } if (r.now && !nowOf.has(r.key)) { nowOf.set(r.key, r.now); } }));
  const head = `<tr><th>위치 · 검토</th><th class="r">지금</th>${list.map(a => `<th class="r" data-alt-col="${esc(a.item)}">${esc(a.label)}${a.is_now ? ' <span class="tag">지금</span>' : ''}</th>`).join('')}</tr>`;
  const idOf = new Map<string, string>();
  cmps.forEach(c => (Array.isArray(c?.rows) ? c.rows : []).forEach((r: CmpRow) => { if (!idOf.has(r.key)) { idOf.set(r.key, r.id); } }));
  const rows = keys.map(k => `<tr data-alt-key="${esc(k)}" data-alt-id="${esc(idOf.get(k) ?? '')}"><td>${esc(label.get(k) ?? k)}</td><td class="r">${cell(nowOf.get(k) ?? null)}</td>${cmps.map((c, i) => {
    const r = (c.rows as CmpRow[]).find(x => x.key === k);
    return `<td class="r" data-alt-cell="${esc(list[i].item)}" data-ratio-v="${typeof r?.alt?.ratio === 'number' ? r.alt.ratio : ''}">${cell(r?.alt ?? null)}</td>`;
  }).join('')}</tr>`).join('');
  const heads = `<tr class="grp"><td>최대 판정비 · NG · 미검토 · A</td><td class="r">${headCell(cmps[0]?.head?.now)}</td>${cmps.map(c => `<td class="r">${headCell(c?.head?.alt)}</td>`).join('')}</tr>`;
  return `<table class="t" data-alt-table><thead>${head}</thead><tbody>${heads}${rows}</tbody></table>`
    + (cmps.some(c => c?.copies) ? `<p class="warn">${esc(cmps.flatMap(c => c?.copies ?? []).join(' · '))}</p>` : '');
}
function headCell(h: any): string {
  if (!h) { return '<span class="faint">—</span>'; }
  const A = typeof h.A === 'number' ? `${sigText(si(h.A, 'area') ?? h.A, 4)} mm²` : '—';
  return `${typeof h.maxRatio === 'number' ? ratio(h.maxRatio, (h.ng ?? 0) > 0) : '—'} · NG ${h.ng ?? 0} · 미검토 ${h.notEvaluated ?? 0} · A ${A}`;
}

/** 정보 창 — 대안 하나(라벨은 AI 의 글 — 자료) */
export function altInfo(key: string): string {
  const id = key.slice(4);
  const a = alts.items.find(x => x.item === id);
  if (!a) { return `<div class="hd"><div class="ttl">대안</div></div><span class="none">${esc(alts.err ?? '그 대안이 없다')}</span>`; }
  const d = a.differs_from_now;
  return `<div class="hd"><div class="k">결과 · 대안 · ${esc(a.item)} <span class="tag ai" data-written-by="${esc(a.written_by)}">${esc(a.written_by.startsWith('ai') ? 'AI' : a.written_by)}</span>${a.is_now ? ' <span class="tag" data-alt-now>지금</span>' : ''}${a.hidden ? ' <span class="tag">숨김</span>' : ''}<span class="sp"></span></div>`
    + `<div class="ttl" data-alt-label>${esc(a.label)}</div><div class="dim">${esc(hhmm(a.created_at))} · 실행 ${esc(a.runs.join(' · '))}</div></div>`
    + `<div class="sec"><h4>판정<span class="sp"></span></h4><dl class="kv"><dt>최대 판정비</dt><dd>${typeof a.max_ratio === 'number' ? ratio(a.max_ratio, a.pass === false) : '—'}</dd>`
    + `<dt>단면적 A</dt><dd>${typeof a.A === 'number' ? `${esc(sigText(si(a.A, 'area') ?? a.A, 4))} mm²` : '—'}</dd></dl></div>`
    + `<div class="sec"><h4${tip('지금 상태와 이 대안의 다른 칸(호스트 — 대안의 스냅숏과 지금)')}>지금과 다른 것<span class="sp"></span></h4>${a.copy ? `<p class="warn">사본 ${esc(a.copy === 'damaged' ? '손상' : '없음')}</p>` : d ? (d.fields ? `<ul class="notes">${d.first.map(f => `<li>${esc(f)}</li>`).join('')}${d.fields > d.first.length ? `<li class="faint">외 ${d.fields - d.first.length}</li>` : ''}</ul>` : '<span class="none">없음 — 지금과 같다</span>') : ''}</div>`
    + `<div class="sec"><div class="btns"><span class="btn${a.is_now || a.copy ? ' off' : ''}" data-alt-open="${esc(a.item)}"${tip('이 대안의 모델 · 입력을 지금 대상에 얹는다 — 변경 묶음 하나, 결과는 다시 돌린다(사본을 결과로 넣지 않는다)')}>이 대안으로</span>`
    + `<span class="btn ghost off" data-alt-${a.hidden ? 'undrop' : 'drop'}="${esc(a.item)}"${tip(PERSON_NO)}>${a.hidden ? '다시 보이기' : '숨기기'}</span></div>`
    + `<div class="btns"><input type="text" maxlength="80" data-alt-newlabel="${esc(a.item)}" placeholder="새 이름" value="${esc(alts.draft[a.item] ?? '')}" disabled><span class="btn ghost off" data-alt-rename="${esc(a.item)}"${tip(PERSON_NO)}>이름 바꾸기</span></div></div>`
    + `<div class="sec"><span class="faint">라벨은 AI 가 쓴 글 — 자료다. 프로그램은 대안의 순위를 짓지 않는다.</span></div>`;
}

/** 정보 창 — 대안 가지: 목록 · 숨긴 것 보이기 · 지금 것을 대안으로 지키기(keep — 지금의 실행 묶음에 이름) */
export function altRootInfo(): string {
  const list = visibleAlts();
  return `<div class="hd"><div class="k">결과 · 대안<span class="sp"></span></div><div class="ttl">대안 ${list.length}</div><div class="dim">라벨 · 최대 판정비 · 「지금」 — 순위는 짓지 않는다</div></div>`
    + `<div class="sec"><h4>목록<span class="sp"></span></h4>${list.length ? `<table class="t"><tbody>${list.map(a => `<tr data-ref-go="${esc(`result|alt:${a.item}`)}"><td>${esc(a.label)}${a.is_now ? ' <span class="tag">지금</span>' : ''}</td>`
      + `<td class="r">${typeof a.max_ratio === 'number' ? ratio(a.max_ratio, a.pass === false) : '—'}</td></tr>`).join('')}</tbody></table>` : '<span class="none">없음</span>'}</div>`
    + `<div class="sec"><h4${tip('지금의 결과(실행 묶음)와 모델 · 입력에 이름을 붙여 둔다 — 나중에 견주고 되돌린다')}>지금 것을 대안으로<span class="sp"></span></h4>`
    + `<div class="btns"><input type="text" maxlength="80" data-alt-newlabel="__keep__" placeholder="이름(예: t 2.3)" value="${esc(alts.draft.__keep__ ?? '')}" disabled><span class="btn off" data-alt-keep="__keep__"${tip(PERSON_NO)}>지키기</span></div></div>`
    + `<div class="sec"><label class="faint"><input type="checkbox" data-alt-hidden${alts.showHidden ? ' checked' : ''}> 숨긴 대안도 보이기</label></div>`;
}
