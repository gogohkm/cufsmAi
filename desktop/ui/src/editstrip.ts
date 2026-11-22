/**
 * 편집 상태의 띠(템플릿 09) — 「이번 편집 — 바뀐 것 N」 칩(편집 상태를 연 때의 검토 상태와 지금의 차이), 「AI 대기 · 알림 N」,
 * 「편집 마치기 F2」 · 「버리기」(되돌리는 길은 변경 기록 R2 부터 — 꺼 둔다).
 *
 * 차이는 호스트의 검토 상태(get_case_inputs) 두 판의 같은 키를 견주는 것이다 — 편집 상태의 설계 화면이 칸을 고치면 호스트의 상태가 바뀌고
 * (K2 caseEdit) 이 화면은 다시 읽는다. 값은 화면의 단위(SI)로 보이기만 한다(units.caseSI).
 */
import { CASE_FIELDS, CASE_KO, OPTION_KO } from './caseFields';
import { esc, tip } from './dom';
import { sigText } from './format';
import { state } from './store';
import { caseSI, LABEL } from './units';

let base: { inputs: Record<string, unknown>; spans: unknown } | null = null;

/** 편집 상태를 열었다 — 지금 판을 기준으로 */
export function beginEdit(): void {
  const c = state.caseIn;
  base = c?.inputs ? { inputs: JSON.parse(JSON.stringify(c.inputs)), spans: JSON.parse(JSON.stringify(c.spans ?? null)) } : null;
}
export function endEdit(): void { base = null; }

const show = (key: string, v: unknown): string => {
  if (v === null || v === undefined || v === '') { return '빈칸'; }
  if (typeof v === 'boolean') { return v ? '켬' : '끔'; }
  if (typeof v === 'string') { return OPTION_KO[v] ?? v; }
  const f = CASE_FIELDS.find(x => x.key === key);
  const { v: sv, kind } = caseSI(v, f?.kind ?? null);
  const u = LABEL[kind] ? ` ${LABEL[kind]}` : '';
  return Array.isArray(sv) ? sv.map(x => (typeof x === 'number' ? sigText(x, 3) : String(x))).join(', ') + u : typeof sv === 'number' ? `${sigText(sv, 3)}${u}` : String(sv);
};

/** 이번 편집의 바뀐 키 */
export function editChanges(): Array<{ key: string; label: string; was: string; now: string }> {
  const c = state.caseIn;
  if (!base || !c?.inputs) { return []; }
  const out: Array<{ key: string; label: string; was: string; now: string }> = [];
  for (const f of CASE_FIELDS) {
    const a = base.inputs[f.key], b = c.inputs[f.key];
    if (JSON.stringify(a) !== JSON.stringify(b)) { out.push({ key: f.key, label: CASE_KO[f.key] ?? f.key, was: show(f.key, a), now: show(f.key, b) }); }
  }
  if (JSON.stringify(base.spans) !== JSON.stringify(c.spans ?? null)) { out.push({ key: 'spans', label: '경간 표', was: '앞', now: '바뀜' }); }
  return out;
}

export function editStripHtml(aiWaiting: number): string {
  const ch = editChanges();
  return `<b>이번 편집 — 바뀐 것 ${ch.length}</b>`
    + ch.slice(0, 6).map(c => `<span class="chip" data-change="${esc(c.key)}">${esc(c.label)} <s>${esc(c.was)}</s> → ${esc(c.now)}</span>`).join('')
    + (ch.length > 6 ? `<span class="faint">외 ${ch.length - 6}</span>` : '')
    + '<span class="sp"></span>'
    + `<span class="faint"${tip('편집 중에는 AI 의 「여기를 보세요」(focus)가 알림으로만 쌓인다 — 마치면 그 알림을 눌러 간다')}>AI 대기 · 알림 ${aiWaiting}</span>`
    + `<span class="btn editp" data-act="edit-done"${tip('편집 상태를 마치고 검토 화면으로(F2 · Esc). 고친 값은 이미 호스트에 있다 — 저장은 따로(Ctrl+S)')}>편집 마치기 F2</span>`
    + `<span class="btn ghost off"${tip('이번 편집을 되돌리는 길은 변경 기록(R2)부터 — 지금은 설계 화면에서 값을 다시 고친다')}>버리기</span>`;
}
