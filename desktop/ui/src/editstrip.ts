/**
 * 편집 상태의 띠(템플릿 09) — 「이번 편집 — 바뀐 것 N」 칩(편집 상태를 연 때의 검토 상태와 지금의 차이), 「AI 대기 · 알림 N」,
 * 「편집 마치기 F2」(→ 호스트의 「사용자 변경」 묶음 하나 — editSession end) · 「버리기」(editSession discard — 호스트가 시작 때의 모델 · 입력으로
 * 되돌린다. 그 사이 AI 가 바꾼 칸은 그대로).
 *
 * 차이는 호스트의 검토 상태(get_case_inputs) 두 판의 같은 키를 견주는 것이다 — 편집 상태의 설계 화면이 칸을 고치면 호스트의 상태가 바뀌고
 * (K2 caseEdit) 이 화면은 다시 읽는다. 값은 화면의 단위(SI)로 보이기만 한다(units.caseSI).
 */
import { CASE_FIELDS, CASE_KO, optionKo } from './caseFields';
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
  if (typeof v === 'string') { return optionKo(key, v) ?? v; }
  const f = CASE_FIELDS.find(x => x.key === key);
  const { v: sv, kind } = caseSI(v, f?.kind ?? null);
  const u = LABEL[kind] ? ` ${LABEL[kind]}` : '';
  return Array.isArray(sv) ? sv.map(x => (typeof x === 'number' ? sigText(x, 3) : String(x))).join(', ') + u : typeof sv === 'number' ? `${sigText(sv, 3)}${u}` : String(sv);
};

export interface EditChange { key: string; label: string; was: string; now: string; src: string }

/**
 * 이번 편집의 바뀐 키 — 출처(호스트 sources)마다 나눈다(V7-43). person = 출처 「지정」(사람이 칸에서 정함)만 「이번 편집 — 바뀐 것」,
 * ai = 편집 중에 AI 가 쓴 것(「AI 가 바꿈」 — 사람의 편집으로 세지 않는다), other = 연동 · 하중 해석 · 파일 · 출처를 모르는 것
 */
export function editChangesBySource(): { person: EditChange[]; ai: EditChange[]; other: EditChange[] } {
  const c = state.caseIn;
  const out = { person: [] as EditChange[], ai: [] as EditChange[], other: [] as EditChange[] };
  if (!base || !c?.inputs) { return out; }
  const put = (x: EditChange) => { (x.src === 'user' ? out.person : x.src === 'ai' ? out.ai : out.other).push(x); };
  for (const f of CASE_FIELDS) {
    const a = base.inputs[f.key], b = c.inputs[f.key];
    if (JSON.stringify(a) !== JSON.stringify(b)) { put({ key: f.key, label: CASE_KO[f.key] ?? f.key, was: show(f.key, a), now: show(f.key, b), src: String(c.sources?.[f.key] ?? '') }); }
  }
  if (JSON.stringify(base.spans) !== JSON.stringify(c.spans ?? null)) { put({ key: 'spans', label: '경간 표', was: '앞', now: '바뀜', src: String(c.sources?.spans ?? '') }); }
  return out;
}
/** 사람이 이번 편집에서 바꾼 것(띠의 칩) */
export function editChanges(): EditChange[] { return editChangesBySource().person; }

export function editStripHtml(aiWaiting: number): string {
  const { person: ch, ai, other } = editChangesBySource();
  return `<b>이번 편집 — 바뀐 것 ${ch.length}</b>`
    + ch.slice(0, 6).map(c => `<span class="chip" data-change="${esc(c.key)}">${esc(c.label)} <s>${esc(c.was)}</s> → ${esc(c.now)}</span>`).join('')
    + (ch.length > 6 ? `<span class="faint">외 ${ch.length - 6}</span>` : '')
    + (other.length ? `<span class="faint" data-other-changes="${other.length}"${tip(`사람이 고친 것이 아닌 변경(연동 · 하중 해석 · 파일): ${other.map(o => o.label).join(', ')}`)}>그 밖 ${other.length}</span>` : '')
    + '<span class="sp"></span>'
    + ai.slice(0, 3).map(c => `<span class="chip ai" data-ai-change="${esc(c.key)}"${tip('편집 중에 AI 가 MCP 도구로 바꾼 값 — 사람의 편집이 아니다')}><b>AI</b> ${esc(c.label)} <s>${esc(c.was)}</s> → ${esc(c.now)}</span>`).join('')
    + (ai.length > 3 ? `<span class="faint">AI 외 ${ai.length - 3}</span>` : '')
    + `<span class="faint" data-ai-waiting${tip('편집 중에는 AI 의 「여기를 보세요」(focus)가 알림으로만 쌓이고, AI 가 바꾼 값은 왼쪽 칩과 따로 보인다')}>AI 대기 · 알림 ${aiWaiting}${ai.length ? ` · AI 가 바꿈 ${ai.length}` : ''}</span>`
    + `<span class="btn editp" data-act="edit-done"${tip('편집 상태를 마치고 검토 화면으로(F2 · Esc). 고친 값은 이미 호스트에 있다 — 저장은 따로(Ctrl+S)')}>편집 마치기 F2</span>`
    + `<span class="btn ghost" data-act="edit-discard"${tip(`이번 편집을 없던 것으로 — 호스트가 편집 상태를 시작할 때의 모델 · 입력으로 되돌린다${ai.length ? '(그 사이 AI 가 바꾼 칸은 그대로)' : ''}. 결과는 다시 돌려야 한다`)}>버리기</span>`;
}
