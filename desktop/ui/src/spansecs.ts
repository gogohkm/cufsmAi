/**
 * 2026-11-28 결정 S1 – S8 — 경간마다 다른 퍼린 단면을 검토 화면에(작업문서 docs/implementation/20261128-span-sections-worklog.md 의 H 기록).
 * 화면은 계산하지 않는다 — 호스트의 검토 상태 · 퍼린 결과 · 랩 결과를 그대로 보인다.
 *
 *  - 입력: 경간 표의 넷째 키 `spans.spanSections`(「단면」)와 `sections`(「단면 목록」 — S2 부터, US 인치. S1 은 늘 모델).
 *    단면마다 Ix 는 호스트가 편집 화면의 「단면 목록」 에 보낸 마지막 `sectionListInfo {info: {S2: {Ixx, A} | {error}}}`(다리가 남긴 것),
 *    S1 의 Ix 는 지금 모델의 단면 성질. 모든 경간이 S1 이고 목록이 비면(`designState.sectionsAreDefault`) 아무것도 더하지 않는다.
 *  - 퍼린 결과(경간마다 단면일 때만): 구간의 `section_id` · 랩 구간의 판정 = 두 부재 강도의 합(결정 S3′ — `sum_of_strengths`: 휨 Mu / Σ φMn ·
 *    전단 Vu / Σ φVn, `strength_basis`), 두 부재 줄(`lap_members` — 단면 · 경간 · 역할 · φMn(`design_strength`) · φVn(`shear_strength`) ·
 *    M 몫(`share`) · V 몫(`share_V`) · 판정비 · 판정, `governing_member`), 강성의 몫으로 본 값(`reference_stiffness_share` — 참고, 판정에 쓰지 않음),
 *    단면이 바뀌는 구간(`sections_checked` · `section_rule`), 평가하지 못한 구간(`not_evaluated_reason` — 합격이 아니다, 그때는 비를 보이지 않는다).
 *    단면마다의 블록(`sections[]` — 성질 · 좌굴값 · 서명곡선 정 · 부 하나씩 · 데크 강성 `deck_used` 한 값(결정 S7′) · 이 단면의 값 `deck_own` 참고).
 *  - 랩 접합: 두 단면을 잇는 랩(`lap_two_members` · `lap_members` 의 Mnℓ · Vn · `Mn_lap` = 합 · `member_governing`('sum' = 강도의 합) ·
 *    `flexure_reference_stiffness_share` · 검토 항목 `lap.bending_shear` 의 `reference_stiffness_share` — 참고), 지점을 정하지 않아 지배 랩을 고른 것
 *    (`section_source.support_defaulted`).
 *
 * 판정: true OK · false NG · 그 밖 「판정 없음」(합격이 아니다). 참고 비는 `data-ratio-ref`(판정비 `data-ratio` 가 아니다).
 */
// @ts-expect-error — UMD(CommonJS) 모듈, 형 정보 없음. 규칙 하나(sectionsAreDefault)만 읽는다
import * as DS from '../../../webview/js/designState.js';
import { esc, tip } from './dom';
import { none, num, ratio, refRatio, sigText, verdictOf } from './format';
import { TEMPLATE_KO } from './names';
import { fieldText, pageOf } from './notices';
import { state } from './store';
import { si, type Kind } from './units';
import { curveSvg, type CurveMark } from './curve';
import { caseTag } from './caseFields';

const DSX = ((DS as any).sectionsAreDefault ? DS : (DS as any).default) as { sectionsAreDefault(a: unknown, b: unknown): boolean };

const row_ = (k: string, v: string, src = '') => `<tr><td>${k}</td><td class="r">${v}</td><td class="src">${src}</td></tr>`;
const sec = (title: string, body: string, right = '', t?: string, attrs = '') => `<div class="sec"${attrs}><h4${tip(t)}>${title}<span class="sp"></span>${right}</h4>${body}</div>`;
const table = (rows: string, attrs = '') => `<table class="t"${attrs}><tbody>${rows}</tbody></table>`;

// ── 입력(검토 상태) ─────────────────────────────────────────────────
/** 경간의 단면(검토 상태) — 없으면 [] */
export const spanSections = (): string[] => (Array.isArray(state.caseIn?.spans?.spanSections) ? state.caseIn.spans.spanSections.map(String) : []);
/** 단면 목록(S2 …, US) — 없으면 [] */
export const caseSections = (): any[] => (Array.isArray(state.caseIn?.sections) ? state.caseIn.sections.filter((x: any) => x && typeof x === 'object') : []);
/** 처음 값(모든 경간 S1 · 목록 없음)이 아닌가 — 아니면 입력 화면에 아무것도 더하지 않는다 */
export function caseSecOn(): boolean {
  const x = state.caseIn;
  if (!x) { return false; }
  try { return !DSX.sectionsAreDefault(x.spans?.spanSections, x.sections); } catch { return false; }
}
const PARAMS: Array<[string, string, Kind]> = [['H', 'H', 'length'], ['B', 'B', 'length'], ['D', 'D', 'length'], ['t', '두께 t', 'length'], ['r', '모서리 r', 'length'], ['qlip', '립 각도', 'none']];
/** 호스트가 편집 화면에 보낸 단면마다의 Ix · A(US) — 없으면 null */
const listInfo = (): any => state.msgs.sectionListInfo?.message?.data ?? null;

function ixHtml(id: string): string {
  if (id === 'S1') {
    const ix = state.propsSI?.Ixx;
    return typeof ix === 'number' ? num(ix, { src: 'props:Ixx', kind: 'inertia', tip: '지금 모델의 단면 성질' }) : none('Ix 없음', '모델의 단면 성질을 읽지 못했다');
  }
  const li = listInfo();
  const x = li?.info?.[id];
  if (!x) { return none('Ix 아직 없음', '호스트가 이 단면의 성질을 아직 보내지 않았다(편집 화면의 「단면 목록」 과 같은 계산)'); }
  if (x.error) { return `<span class="un" data-sec-error="${esc(id)}"${tip(`호스트가 이 치수로 단면을 만들지 못했다 — ${String(x.error)}`)}>만들지 못함</span>`; }
  return num(si(x.Ixx, 'inertia'), { src: `secinfo:${id}.Ixx`, kind: 'inertia', tip: '호스트가 이 치수로 만든 단면의 Ixx(편집 화면의 「단면 목록」 과 같은 값)' });
}

/** 트리 — 부재 가지 아래 「단면」 · 「단면 목록」(처음 값이면 없음) */
export interface SecKid { k: string; t: string; vHtml: string; src?: string; tip?: string; kids?: SecKid[] }
export function caseSecKids(): SecKid[] {
  if (!caseSecOn()) { return []; }
  const ss = spanSections();
  const src = state.caseIn?.sources ?? {};
  const list = caseSections();
  const short = (s: any) => {
    const p = s.params ?? {};
    return ['H', 'B', 't'].filter(k => typeof p[k] === 'number').map(k => `${k} ${sigText(si(p[k], 'length')!, 4)}`).join(' · ') + ' <span class="u">mm</span>';
  };
  return [
    { k: 'case:spanSections', t: '단면', vHtml: ss.length ? `<span data-span-sections="${esc(ss.join(','))}">${ss.map(esc).join(' · ')}</span>` : none('없음'), src: src.spanSections,
      tip: '경간마다 단면(경간 1 부터) — S1 은 지금 모델. 고치는 곳은 편집 상태의 경간 표 「단면」 칸' },
    { k: 'case:sections', t: '단면 목록', vHtml: `S1 모델 + ${list.length}`, src: src.sections, tip: 'S1 은 모델(읽기만), S2 부터 같은 템플릿의 치수 — 편집 상태의 「단면 목록」',
      kids: list.map(s => ({ k: `case:sections.${s.id}`, t: `${String(s.id)}${s.name ? ` · ${String(s.name)}` : ''}`, vHtml: short(s),
        tip: `단면 ${String(s.id)} — ${TEMPLATE_KO[String(s.template)] ?? String(s.template ?? '')} · 쓰는 경간 ${ss.map((x, j) => (x === s.id ? j + 1 : 0)).filter(Boolean).join(', ') || '없음'}` })) },
  ];
}

/** 정보 창 — 경간 표의 「단면」 칸(처음 값이면 null — 표가 앞과 같다) */
export const spanSecCell = (i: number): string | null => {
  if (!caseSecOn()) { return null; }
  const id = spanSections()[i];
  return typeof id === 'string' ? `<span data-span-sec="${i}">${esc(id)}</span>` : '<span class="faint">—</span>';
};

/** 정보 창 — 「단면 목록」 표(S1 = 모델 · S2 … 의 치수(mm) · 계산된 Ix). 처음 값이면 '' */
export function sectionListTable(): string {
  if (!caseSecOn()) { return ''; }
  const f = state.full;
  const tpl = String(f?.section_template ?? '');
  const mp = f?.section_params ?? {};
  const ss = spanSections();
  const used = (id: string) => ss.map((x, j) => (x === id ? j + 1 : 0)).filter(Boolean).join(', ') || '<span class="faint">없음</span>';
  const cell = (v: unknown, kind: Kind, src: string) => (typeof v === 'number' ? num(kind === 'none' ? v : si(v, kind), { src, kind, unit: false, sig: 4 }) : '<span class="faint">—</span>');
  const s1 = `<tr data-sec-row="S1"><td><b>S1</b></td><td>모델 <span class="tag sec"${tip('S1 은 언제나 지금 단면 모델이다 — 이 표에서 고치지 않는다(단면 탭 · AI 의 set_section_template)')}>읽기만</span></td>`
    + PARAMS.map(([k, , kind]) => `<td class="r">${cell(mp[k], kind, `full:section_params.${k}`)}</td>`).join('') + `<td class="r">${ixHtml('S1')}</td><td>${used('S1')}</td></tr>`;
  const rows = caseSections().map((s, i) => {
    const bad = tpl && s.template && s.template !== tpl;
    return `<tr data-sec-row="${esc(s.id)}"${bad ? ' class="warn"' : ''}><td><b>${esc(s.id)}</b></td><td>${s.name ? esc(s.name) : '<span class="faint">이름 없음</span>'}${bad ? ` <span class="tag warn"${tip(`이 단면의 템플릿(${String(s.template)})이 모델(${tpl})과 다르다 — 호스트가 실행을 막는다`)}>템플릿 다름</span>` : ''}</td>`
      + PARAMS.map(([k, , kind]) => `<td class="r">${cell(s.params?.[k], kind, `case:sections.${i}.params.${k}`)}</td>`).join('') + `<td class="r">${ixHtml(String(s.id))}</td><td>${used(String(s.id))}</td></tr>`;
  }).join('');
  return sec('단면 목록',
    `<table class="t etab" data-table="case-sections"><thead><tr><th>단면</th><th>이름</th>${PARAMS.map(([, t]) => `<th class="r">${t}${t === '립 각도' ? ' °' : ' mm'}</th>`).join('')}<th class="r">Ix mm⁴</th><th>경간</th></tr></thead><tbody>${s1}${rows}</tbody></table>`,
    state.caseIn?.sources?.sections ? caseTag(state.caseIn.sources.sections) : '', '경간마다 다른 퍼린 단면(결정 S1 · S2) — S1 은 지금 모델, S2 부터 같은 템플릿의 치수(바깥-바깥 · r 은 안쪽 반지름). Ix 는 호스트가 그 치수로 만든 단면의 값', ' data-sec-list');
}

// ── 퍼린 결과 ───────────────────────────────────────────────────────
export const psecOn = (): boolean => !!state.psec;
const secName = (id: unknown): string => {
  const s = state.psec?.us.find((x: any) => x?.id === id);
  return `${esc(String(id ?? '—'))}${s?.name ? ` <span class="faint">${esc(s.name)}</span>` : s?.source === 'model' ? ' <span class="faint">모델</span>' : ''}`;
};
const ROLE: Record<string, string> = { continuous: '이어지는 부재', ends_at_lap_end: '랩 끝에서 끝나는 부재' };
const ROLE_SHORT: Record<string, string> = { continuous: '이어짐', ends_at_lap_end: '끝남' };
/** 표 칸의 단면(id 만 — 이름은 풍선) */
const secId = (id: unknown): string => {
  const s = state.psec?.us.find((x: any) => x?.id === id);
  return `<span${tip(s?.name ? String(s.name) : s?.source === 'model' ? '모델' : '')}>${esc(String(id ?? '—'))}</span>`;
};
const vText = (p: unknown) => verdictOf(p, '판정 없음');
/** 부재 한 줄의 판정비 — OK · NG 만 판정비, 판정 없음이면 참고 비(합격이 아니다) */
function memberRatio(m: any, src: string): string {
  const u = m?.utilization;
  if (typeof u !== 'number' || !Number.isFinite(u)) { return '<span class="faint">—</span>'; }
  if (m.pass === true || m.pass === false) { return ratio(u, m.pass === false, src); }
  return refRatio(u, '이 부재는 판정이 없다(평가하지 못한 항목이 있다) — 이 비는 판정비가 아니고 합격도 아니다');
}

/**
 * 정보 창 — 퍼린 구간 하나의 단면 · 부재(경간마다 단면일 때만). rg = state.regions 의 것, ri = 그 차례
 */
export function regionSecBlock(rg: { us: any; si: any } | undefined, ri: number): string {
  if (!state.psec || !rg?.us) { return ''; }
  const us = rg.us, s = rg.si ?? {};
  const pre = `purlin:regions.${ri}.`;
  const rows: string[] = [];
  const ne = us.result?.pass !== true && us.result?.pass !== false && typeof us.not_evaluated_reason === 'string';
  rows.push(row_('판정한 단면', us.section_id ? secName(us.section_id) : '<span class="un">없음</span>',
    `<span class="why">${Array.isArray(us.lap_members) ? '랩 — 지배 부재의 단면' : Array.isArray(us.sections_checked) ? '단면이 바뀌는 구간 — 지배 단면' : '그 구간의 최대 모멘트가 놓인 경간의 단면'}</span>`));
  if (Number.isInteger(us.span)) { rows.push(row_('경간', `${us.span + 1}${Array.isArray(us.spans) && us.spans.length > 1 ? ` <span class="faint">(구간이 닿는 경간 ${us.spans.map((j: number) => j + 1).join(', ')})</span>` : ''}`, '<span class="tag drv">하중 해석</span>')); }
  if (ne) {
    rows.push(row_('판정', `<span class="verdict un" data-region-ne="${esc(String(us.not_evaluated_reason_code ?? ''))}"${tip('이 구간은 평가하지 못했다 — 합격이 아니다')}>평가하지 못함</span>`, ''));
    rows.push(row_('까닭', `<span data-ne-reason${us.not_evaluated_reason_code ? ` data-code="${esc(us.not_evaluated_reason_code)}"` : ''}>${esc(fieldText(us, 'not_evaluated_reason'))}</span>`, ''));
  }
  if (us.section_rule === 'crosses_section_change') {
    rows.push(row_('규칙', `<span data-section-rule="crosses_section_change"${tip('랩 없이 단면이 바뀌는 지점을 지나는 구간 — 그 단면마다 구간 전체의 소요로 검토하고 지배하는 단면이 판정한다(약한 단면이 주지 않을 합격을 내지 않는다)')}>단면마다 구간 전체의 소요 — 지배 단면이 판정</span>`, ''));
  }
  const lap = Array.isArray(us.lap_members);
  const depth = lap && us.depth_mismatch === true ? `<div class="notice" data-depth-mismatch${tip('결정 S4 — 설계 매뉴얼의 가정은 같은 춤의 겹친 부재다')}>두 부재의 춤이 다르다 — 이 랩 구간은 평가하지 않는다(판정 없음 · 합격이 아니다)</div>` : '';
  // 검증 2026-11-28 F2 의 1: 한 쪽 강도만 아는 랩 — 아는 쪽의 강도의 합 줄(불합격이면 구간이 불합격)과 평가하지 못한 항목 · 까닭
  if (!ne && lap && Array.isArray(us.lap_items_not_evaluated) && us.lap_items_not_evaluated.length) {
    rows.push(row_('평가하지 못한 항목', `<span class="un" data-lap-items-ne="${esc(us.lap_items_not_evaluated.join(','))}">${us.lap_items_not_evaluated.map((k: string) => esc(LAP_ITEM_KO[k] ?? k)).join(' · ')}</span>`
      + (typeof us.not_evaluated_reason === 'string' ? ` <span class="faint" data-ne-reason${us.not_evaluated_reason_code ? ` data-code="${esc(us.not_evaluated_reason_code)}"` : ''}>— ${esc(fieldText(us, 'not_evaluated_reason'))}</span>` : ''),
    `<span class="why"${tip('불합격이 평가하지 못한 항목을 이긴다 — 아는 쪽이 넘으면 구간은 불합격, 아니면 판정 없음(합격이 아니다)')}>${us.result?.pass === false ? '불합격이 이긴다' : '판정 없음'}</span>`));
  }
  const hasSum = !!(us.sum_of_strengths && typeof us.sum_of_strengths === 'object');
  const body = lap ? (ne && !hasSum ? '' : lapSumRows(us, s, pre)) + lapMembersTable(us, s, pre, ne) + (ne ? '' : stiffRef(us, s, pre)) : sectionsCheckedTable(us, s, pre);
  return sec(lap ? '단면 · 랩의 두 부재' : '단면 — 경간마다', table(rows.join('')) + depth + body, '',
    '경간마다 다른 퍼린 단면(결정 S1 · S3′ · S4) — 호스트의 퍼린 결과 그대로', ` data-region-sec="${esc(String(us.id ?? ri))}"`);
}

const n4 = (v: unknown, src: string, kind: Kind, sig = 4) => (typeof v === 'number' && Number.isFinite(v) ? num(v, { src, kind, unit: false, sig }) : '<span class="faint">—</span>');
const memberVerdict = (m: any, attrs: string) => {
  const v = vText(m?.pass);
  return `<td class="r verdict ${v.cls}" style="font-weight:400"${attrs} data-member-verdict="${m?.pass === true ? 'ok' : m?.pass === false ? 'ng' : 'none'}">${v.text}</td>`;
};

/**
 * 랩의 두 부재 — 정보 창이 좁아 부재를 열로(줄 = 단면 · 경간 · 역할 · φMn · φVn · M 몫 · V 몫 · 비 · 판정). 칸마다 `data-m`(부재 1 · 2) · `data-f`(무엇).
 * 결정 S3′: 부재는 제 강도의 몫(M · V)으로 엔진이 검토 — 그 비 · 판정이 부재의 판정. 평가하지 못한 랩이면 지배 표시 없이(비 · 판정 없음)
 */
function lapMembersTable(us: any, s: any, pre: string, ne: boolean): string {
  const ms: any[] = us.lap_members;
  if (!ms.length) { return ''; }
  const gov = !ne && Number.isInteger(us.governing_member) ? us.governing_member - 1 : -1;
  const cell = (j: number, f: string, html: string, cls = 'r', extra = '') => `<td class="${cls}${j === gov ? ' on' : ''}" data-m="${j + 1}" data-f="${f}"${extra}>${html}</td>`;
  const line = (t: string, f: string, html: (m: any, ss: any, j: number, p: string) => string, why = '') => `<tr data-lap-row="${f}"><td${tip(why)}>${t}</td>`
    + ms.map((m: any, j: number) => cell(j, f, html(m, s.lap_members?.[j] ?? m, j, `${pre}lap_members.${j}.`))).join('') + '</tr>';
  const head = `<tr><th></th>${ms.map((_m: any, j: number) => `<th class="r${j === gov ? ' on' : ''}" data-lap-member="${j + 1}"${j === gov ? ' data-gov="1"' : ''} style="white-space:nowrap">부재 ${j + 1}`
    + `${j === gov ? ` <span class="tag"${tip('구간의 판정과 판정비를 정한 부재(불합격 → 판정 없음 → 큰 판정비 차례)')}>지배</span>` : ''}</th>`).join('')}</tr>`;
  const roleRow = `<tr data-lap-row="role"><td>역할</td>${ms.map((m: any, j: number) => cell(j, 'role', esc(ROLE_SHORT[String(m?.role)] ?? String(m?.role ?? '—')), 'r', ` data-role="${esc(String(m?.role ?? ''))}"${tip(ROLE[String(m?.role)] ?? '')}`)).join('')}</tr>`;
  const verdictRow = `<tr data-lap-row="verdict"><td>판정</td>${ms.map((m: any, j: number) => memberVerdict(m, ` data-m="${j + 1}" data-f="verdict"`)).join('')}</tr>`;
  return `<table class="t" data-table="lap-members"><thead>${head}</thead><tbody>`
    + line('단면', 'sec', (m) => secId(m?.section_id))
    + line('경간', 'span', (m) => (Number.isInteger(m?.span) ? String(m.span + 1) : '—'))
    + roleRow
    // 결정 S3′: 그 부재의 휨 · 전단 설계강도와 강도의 몫(M = φMn,i / Σ φMn · V = φVn,i / Σ φVn)
    + line('φMn <span class="u">kN·m</span>', 'phiMn', (_m, x, _j, p) => n4(x?.design_strength, `${p}design_strength`, 'moment'), '그 부재의 휨 설계강도(M 최대 지점 — 그 구간의 지배 휨강도)')
    + line('φVn <span class="u">kN</span>', 'phiVn', (_m, x, _j, p) => n4(x?.shear_strength, `${p}shear_strength`, 'force'), '그 부재의 전단 설계강도')
    + line('M 몫', 'shareM', (_m, x, _j, p) => `<span data-share-m>${n4(x?.share, `${p}share`, 'none')}</span>`, 'M 의 강도 몫 φMn,i / Σ φMn — 그 부재가 지는 M')
    + line('V 몫', 'shareV', (_m, x, _j, p) => `<span data-share-v>${n4(x?.share_V, `${p}share_V`, 'none')}</span>`, 'V 의 강도 몫 φVn,i / Σ φVn — 그 부재가 지는 V')
    + line('비', 'ratio', (m, _x, _j, p) => memberRatio(m, `${p}utilization`), '그 부재를 제 몫으로 엔진이 검토한 판정비(지배 검토)')
    + verdictRow + '</tbody></table>';
}

/** 랩 없이 단면이 바뀌는 지점을 지나는 구간 — 검토한 단면마다(구간 전체의 소요) */
function sectionsCheckedTable(us: any, s: any, pre: string): string {
  const lines: any[] = Array.isArray(us.sections_checked) ? us.sections_checked : [];
  if (!lines.length) { return ''; }
  const govSec = lines.length > 1 ? lines.findIndex((m: any) => m?.section_id === us.section_id && m?.pass === us.result?.pass && m?.utilization === us.result?.utilization) : -1;
  const body = lines.map((m: any, j: number) => {
    const ms = s.sections_checked?.[j] ?? m;
    const isGov = j === govSec;
    const p = `${pre}sections_checked.${j}.`;
    return `<tr data-sec-checked="${j + 1}"${isGov ? ' data-gov="1" class="on"' : ''}><td style="white-space:nowrap">${isGov ? `<span class="tag"${tip('구간의 판정을 정한 단면')}>지배</span>` : ''}</td>`
      + `<td>${secId(m?.section_id)}</td><td class="r">${Number.isInteger(m?.span) ? m.span + 1 : '—'}</td>`
      + `<td class="r">${n4(ms?.Mu, `${p}Mu`, 'moment')}</td><td class="r">${n4(ms?.Vu, `${p}Vu`, 'force')}</td>`
      + `<td class="r">${memberRatio(m, `${p}utilization`)}</td>${memberVerdict(m, '')}</tr>`;
  }).join('');
  return `<table class="t" data-table="sections-checked"><thead><tr><th></th><th>단면</th><th class="r">경간</th><th class="r">Mu kN·m</th><th class="r">Vu kN</th><th class="r">비</th><th class="r">판정</th></tr></thead><tbody>${body}</tbody></table>`;
}

const SUM_BASIS = '두 부재 강도의 합 — 설계 매뉴얼 II-1A · II-2A 의 가정';
/** F2 의 1: 랩의 평가하지 못한 항목(호스트 lap_items_not_evaluated) */
const LAP_ITEM_KO: Record<string, string> = { flexure: '휨', shear: '전단(§G2)', bending_shear: '휨 + 전단(§H2)' };
/**
 * 결정 S3′ — 랩 구간의 판정 줄: 휨 Mu / Σ φMn · 전단 Vu / Σ φVn(부재마다의 강도와 함께), 구간의 지배 판정비 · 판정(결과 그대로).
 * 구간의 판정이 OK · NG 일 때만 판정비로, 판정 없음이면 참고 비(합격이 아니다). 평가하지 못한 랩은 부르지 않는다(까닭만)
 */
function lapSumRows(us: any, s: any, pre: string): string {
  const sum = us.sum_of_strengths;
  if (!sum || typeof sum !== 'object') { return ''; }
  const ss = s.sum_of_strengths ?? sum;
  const p = `${pre}sum_of_strengths.`;
  const decided = us.result?.pass === true || us.result?.pass === false;
  const r = (v: unknown, src: string) => (typeof v !== 'number' || !Number.isFinite(v) ? '<span class="faint">—</span>'
    : decided ? ratio(v, v > 1, src) : refRatio(v, '구간의 판정이 없다(평가하지 못한 항목이 있다) — 이 비는 판정비가 아니고 합격도 아니다'));
  const q = (v: unknown, src: string, kind: Kind) => (typeof v === 'number' && Number.isFinite(v) ? num(v, { src, kind, sig: 4 }) : '<span class="faint">—</span>');
  const parts = (xs: unknown, k: string, kind: Kind) => (Array.isArray(xs) ? xs.map((_x, j) => n4(ss[k]?.[j], `${p}${k}.${j}`, kind)).join(' + ') : '');
  // F2 의 1: 한 쪽 강도만 알면 모르는 쪽은 「평가하지 못함」(판정비 없음 — 합격으로 그리지 않는다)
  const neItem = (k: string) => `<span class="un" data-sum-ne="${k}"${tip('부재 하나의 설계강도를 얻지 못해 두 부재 강도의 합을 만들 수 없다 — 평가하지 못함(합격이 아니다)')}>평가하지 못함</span>`;
  const neList: string[] = Array.isArray(sum.not_evaluated) ? sum.not_evaluated : [];
  const fl = typeof sum.flexure_ratio !== 'number' && neList.includes('flexure')
    ? `Mu ${q(ss.Mu, `${p}Mu`, 'moment')} / Σ φMn (${parts(sum.design_strengths, 'design_strengths', 'moment')}) — ${neItem('flexure')}`
    : `Mu ${q(ss.Mu, `${p}Mu`, 'moment')} / Σ φMn (${parts(sum.design_strengths, 'design_strengths', 'moment')} = ${q(ss.design_strength_sum, `${p}design_strength_sum`, 'moment')}) = ${r(sum.flexure_ratio, `${p}flexure_ratio`)}`;
  const sh = Array.isArray(sum.shear_strengths) && typeof sum.Vu === 'number'
    ? (typeof sum.shear_ratio !== 'number' && neList.includes('shear')
      ? `Vu ${q(ss.Vu, `${p}Vu`, 'force')} / Σ φVn (${parts(sum.shear_strengths, 'shear_strengths', 'force')}) — ${neItem('shear')}`
      : `Vu ${q(ss.Vu, `${p}Vu`, 'force')} / Σ φVn (${parts(sum.shear_strengths, 'shear_strengths', 'force')} = ${q(ss.shear_strength_sum, `${p}shear_strength_sum`, 'force')}) = ${r(sum.shear_ratio, `${p}shear_ratio`)}`)
    : '<span class="faint">소요 전단 없음 — 전단은 검토하지 않았다</span>';
  const h2 = neList.includes('bending_shear') ? neItem('bending_shear')
    : typeof sum.bending_shear_ratio === 'number' ? `${r(sum.bending_shear_ratio, `${p}bending_shear_ratio`)} <span class="faint">두 부재 값 가운데 큰 것</span>` : '<span class="faint">—</span>';
  const v = vText(us.result?.pass);
  const gv = `${r(us.result?.utilization, `${pre}result.utilization`)} <span class="verdict ${v.cls}" style="font-weight:400" data-sum-verdict="${us.result?.pass === true ? 'ok' : us.result?.pass === false ? 'ng' : 'none'}">${v.text}</span>`
    + (us.result?.governing_check ? ` <span class="faint">${esc(String(pageOf(us.result)?.governing_check ?? us.result.governing_check))}</span>` : '');
  return table(row_('휨', `<span data-sum-flexure>${fl}</span>`, '<span class="tag drv">강도의 합</span>')
    + row_('전단', `<span data-sum-shear>${sh}</span>`, '<span class="tag drv">강도의 합</span>')
    + row_('휨 + 전단 §H2', `<span data-sum-h2>${h2}</span>`, `<span class="why"${tip('§H2 는 강도의 몫으로 본 두 부재의 값 가운데 큰 것 — 부재마다 지배 휨강도가 §H2 가 쓰는 강도(Malo)이면 합한 강도로 본 값과 같고, 다른 휨 한계상태가 지배하면 조금 크다(안전측)')}>엔진 · 부재마다</span>`)
    + row_('구간',`<span data-sum-gov>${gv}</span>`, `<span class="why"${tip('§H2(휨 + 전단)도 강도의 몫으로 부재마다 엔진이 검토 — 구간의 판정비는 두 부재 가운데 큰 것')}>지배</span>`), ' data-lap-sum')
    + `<div class="dim" data-strength-basis="${esc(String(us.strength_basis ?? sum.basis ?? ''))}"${tip(`결정 S3′(${SUM_BASIS}) — 각 부재가 제 강도의 비만큼 M · V 를 진다고 보고 엔진이 부재마다 검토한다(판정비 = 강도의 합으로 본 값). 두 단면이 같으면 몫이 절반씩`)}>${esc(fieldText(sum, 'label') || SUM_BASIS)}</div>`;
}

/** 결정 S3′ — 강성(Ix)의 몫으로 본 값은 참고만(판정에 쓰지 않음 — 색 없음 · 세지 않음) */
function stiffRef(us: any, s: any, pre: string): string {
  const ref = us.reference_stiffness_share;
  if (!ref || typeof ref !== 'object') { return ''; }
  const rs = s.reference_stiffness_share ?? ref;
  const ms: any[] = Array.isArray(ref.members) ? ref.members : [];
  const why = '참고만 — 판정은 두 부재 강도의 합으로(결정 S3′). 이 비는 판정비가 아니다';
  const each = ms.map((m: any, j: number) => `부재 ${j + 1} ${esc(String(m?.section_id ?? '—'))} 몫 ${typeof rs.shares?.[j] === 'number' ? num(rs.shares[j], { src: `${pre}reference_stiffness_share.shares.${j}`, kind: 'none', unit: false, sig: 4 }) : '—'}`
    + ` → ${typeof m?.utilization === 'number' ? refRatio(m.utilization, why) : '<span class="faint">—</span>'}`).join(' · ');
  return `<div class="dim" data-stiff-ref${tip(fieldText(ref, 'label') || why)}>참고 — 판정에 쓰지 않음: 강성(Ix)의 몫 I_i / (I_1 + I_2) 로 본 부재의 비 — ${each}</div>`;
}

/** 트리 — 결과 탭의 「퍼린 단면」(경간마다 단면일 때만) */
export interface PsecNode { k: string; t: string; v: string; tip: string }
export function psecKids(): PsecNode[] {
  const p = state.psec;
  if (!p) { return []; }
  return p.us.map((s: any) => ({ k: `psec:${String(s.id)}`, t: `${String(s.id)}${s.name ? ` · ${String(s.name)}` : s.source === 'model' ? ' · 모델' : ''}`,
    v: `경간 ${(Array.isArray(s.spans) ? s.spans : []).map((j: number) => j + 1).join(', ') || '—'}`, tip: '이 단면의 성질 · 좌굴값(정 · 부) · 데크 강성 · 서명곡선 — 퍼린 결과의 단면 블록(호스트)' }));
}
const idxOf = (id: string): number => state.psec?.us.findIndex((x: any) => String(x?.id) === id) ?? -1;
export const psecIdOf = (key: string): string => (key.startsWith('psec:') ? key.slice(5) : String(state.psec?.us[0]?.id ?? 'S1'));

const DSM_ROWS: Array<[string, string, string, Kind]> = [['Mxxcrl', 'Lcrl', '국부 Mcrℓ', 'moment'], ['Mxxcrd', 'Lcrd', '뒤틀림 Mcrd', 'moment'], ['Mxxcre', 'Lcre', '전체 Mcre', 'moment']];
function dsmRows(d: any, src: string): string {
  if (!d || typeof d !== 'object') { return row_('좌굴값', none('없음', '호스트가 이 단면의 좌굴값을 내지 않았다'), ''); }
  return DSM_ROWS.map(([k, L, t, kind]) => row_(t, typeof d[k] === 'number' ? `${num(d[k], { src: `${src}${k}`, kind, sig: 4 })}${typeof d[L] === 'number' ? ` @ ${num(d[L], { src: `${src}${L}`, kind: 'length', sig: 4 })}` : ''}` : none('없음'), '<span class="tag drv">서명곡선</span>')).join('')
    + (typeof d.My_xx === 'number' ? row_('My', num(d.My_xx, { src: `${src}My_xx`, kind: 'moment', sig: 4 }), '') : '');
}

/** 정보 창 — 단면 하나(성질 · 치수 · 좌굴값 정 · 부 · 쓴 데크 강성(한 값) · 이 단면의 값(다를 때 참고)) */
export function psecInfo(key: string): string {
  const p = state.psec;
  if (!p) { return `<div class="hd"><div class="k">결과 · 퍼린 단면</div><div class="ttl">경간마다 단면 없음</div></div>`; }
  const id = psecIdOf(key);
  const i = idxOf(id);
  const us = p.us[i], s = p.si[i] ?? us;
  if (!us) { return `<div class="hd"><div class="k">결과 · 퍼린 단면</div><div class="ttl">${esc(id)} 없음</div></div>`; }
  const pre = `purlin:sections.${i}.`;
  const params = PARAMS.filter(([k]) => typeof s.params?.[k] === 'number').map(([k, t, kind]) => row_(t, num(s.params[k], { src: `${pre}params.${k}`, kind, sig: 4 }) + (kind === 'none' ? '°' : ''), '')).join('');
  const PROPS: Array<[string, string, Kind]> = [['A', 'A', 'area'], ['Ixx', 'Ixx', 'inertia'], ['Izz', 'Izz', 'inertia'], ['Sf', 'Sf', 'modulus'], ['Sx', 'Sx', 'modulus']];
  const props = PROPS.filter(([k]) => typeof s.props?.[k] === 'number').map(([k, t, kind]) => row_(t, num(s.props[k], { src: `${pre}props.${k}`, kind, sig: 5 }), '<span class="tag sec">단면</span>')).join('');
  const spans = (Array.isArray(us.spans) ? us.spans : []).map((j: number) => j + 1).join(', ');
  return `<div class="hd"><div class="k">결과 · 퍼린 단면<span class="sp"></span></div><div class="ttl" data-psec-title="${esc(id)}">${esc(id)}${us.name ? ` · ${esc(us.name)}` : us.source === 'model' ? ' · 모델' : ''}</div>`
    + `<div class="dim">${esc(TEMPLATE_KO[String(us.template)] ?? String(us.template ?? ''))} · 쓰는 경간 ${esc(spans || '없음')}</div></div>`
    + sec('치수', table(params || row_('치수', none('없음'), '')), '', '그 단면의 템플릿 치수(바깥-바깥, r 은 안쪽 반지름)')
    + sec('단면 성질', table(props || row_('성질', none('없음'), '')), '', '호스트가 그 치수로 만든 단면의 성질')
    + sec('좌굴값 — 정모멘트(+M)', table(dsmRows(s.dsm_pos, `${pre}dsm_pos.`)), '', 'S-S 서명곡선(설계 Fy) · 데크 스프링(아래의 「데크 강성」 — 모든 경간에 한 값) — 정모멘트 구간이 쓴 값', ' data-psec-dsm="pos"')
    + sec('좌굴값 — 부모멘트(−M)', table(dsmRows(s.dsm_neg, `${pre}dsm_neg.`)), '', 'S-S 서명곡선(설계 Fy) · 스프링 없음 — 부모멘트 · 랩 구간이 쓴 값', ' data-psec-dsm="neg"')
    + deckBlock(us, s, pre)
    + `<div class="sec"><span class="faint">해석 탭의 좌굴 해석은 S1(모델)의 것이다(결정 S8) — 이 단면의 서명곡선은 가운데 그림</span></div>`;
}

/**
 * 결정 S7′ — 데크 강성은 한 번: 쓰이는 단면 가운데 kφ 가 가장 작은 단면의 값을 모든 경간에(설계 매뉴얼 II-1C 의 안전측 근사).
 * 쓴 값(`deck_used` — 어느 단면의 것인지)과, 이 단면의 값(`deck_own`)이 다르면 그것을 참고로. 데크가 없으면(쓴 값 없음) 아무것도 없다
 */
function deckBlock(us: any, s: any, pre: string): string {
  const du = us.deck_used, ds = s.deck_used ?? du;
  if (!du || typeof du !== 'object' || (typeof du.kphi !== 'number' && typeof du.kx !== 'number')) { return ''; }
  // 검증 2026-11-28 F2 의 2: kφ 와 kx 는 따로 가장 작은 값 — 값마다 그 단면(같으면 한 단면)
  const kphiId = du.kphi_section_id != null ? String(du.kphi_section_id) : '';
  const kxId = du.kx_section_id != null ? String(du.kx_section_id) : '';
  const oneSec = kphiId !== '' && kphiId === kxId;
  const kv = (o: any, p: string, ids = false) => `kφ ${num(o?.kphi, { src: `${p}.kphi`, kind: 'rot_stiff', sig: 4 })}${ids && !oneSec && kphiId ? ` <span class="faint" data-deck-kphi-sec="${esc(kphiId)}">(${esc(kphiId)})</span>` : ''}`
    + ` · kx ${num(o?.kx, { src: `${p}.kx`, kind: 'lat_stiff', sig: 4 })}${ids && !oneSec && kxId ? ` <span class="faint" data-deck-kx-sec="${esc(kxId)}">(${esc(kxId)})</span>` : ''}`;
  const own = us.deck_own, os = s.deck_own ?? own;
  const differs = own && typeof own === 'object' && (own.kphi !== du.kphi || own.kx !== du.kx);
  const tag = oneSec ? `${esc(kphiId)} 의 값` : kphiId || kxId ? `kφ ${esc(kphiId || '—')} · kx ${esc(kxId || '—')}` : '데크';
  const rule = oneSec ? `한 번 계산 — kφ · kx 가 가장 작은 단면(${esc(kphiId)})의 값을 모든 경간에`
    : kphiId || kxId ? `한 번 계산 — 가장 작은 kφ(단면 ${esc(kphiId || '—')})와 가장 작은 kx(단면 ${esc(kxId || '—')})를 따로 모든 경간에`
      : '한 번 계산 — 가장 작은 kφ 와 가장 작은 kx 를 따로 모든 경간에';
  return sec('데크 강성', table(
    row_('쓴 값', `<span data-deck-used="${esc(oneSec ? kphiId : [kphiId, kxId].filter(Boolean).join(','))}">${kv(ds, `${pre}deck_used`, true)}</span>`, `<span class="tag drv">${tag}</span>`)
    + row_('규칙', `<span data-deck-rule${tip('설계 매뉴얼 II-1C 의 「안전측의 근사」 — 두께만 다르면 얇은 쪽. kφ 와 kx 를 따로 가장 작은 값으로 골라 어느 경간도 제 단면의 값보다 큰 데크 강성을 받지 않는다. 모든 경간의 정모멘트 곡선이 이 한 값으로')}>${rule}</span>`, '')
    + (differs ? row_('이 단면의 값', `<span class="faint" data-deck-own${tip('참고 — 이 단면의 t · B 로 계산한 값. 쓰지 않았다')}>${kv(os, `${pre}deck_own`)} · 참고 — 쓰지 않음</span>`, '') : '')),
  '', '결정 S7′ — 데크 강성 하나(호스트의 퍼린 결과 그대로)', ' data-psec-deck');
}

/** 가운데 — 고른 단면의 서명곡선(정 · 부 — 단면마다 하나씩) · 단면 고르기 */
export const psecSel: { curve: string } = { curve: 'pos' };
export function psecView(key: string, size: { w: number; h: number }): string {
  const p = state.psec;
  if (!p) { return `<div class="dv ph"><div class="ph-box"><b>경간마다 단면 없음</b><span>지금 퍼린 결과는 모든 경간이 S1 이다</span></div></div>`; }
  const id = psecIdOf(key);
  const i = idxOf(id);
  const us = p.us[i], s = p.si[i] ?? us;
  if (!us) { return `<div class="dv ph"><div class="ph-box"><b>${esc(id)} 없음</b><span>지금 퍼린 결과에 이 단면이 없다</span></div></div>`; }
  // 결정 S7′: 단면마다 정모멘트 곡선 하나(데크 강성 한 값) · 부모멘트 곡선 하나
  const opts: Array<[string, string]> = [['pos', '정모멘트 +M'], ['neg', '부모멘트 −M']];
  if (!opts.some(([k]) => k === psecSel.curve)) { psecSel.curve = 'pos'; }
  const c = psecSel.curve;
  const cv = us.curves?.[c];
  const dUS = c === 'neg' ? us.dsm_neg : us.dsm_pos;
  const dSI = c === 'neg' ? s.dsm_neg : s.dsm_pos;
  const dsrc = `purlin:sections.${i}.dsm_${c === 'neg' ? 'neg' : 'pos'}.`;
  const L: number[] = Array.isArray(cv?.lengths) ? cv.lengths : [];
  const lf: number[] = Array.isArray(cv?.load_factors) ? cv.load_factors : [];
  const rows = L.map((x, j) => [x, lf[j]]).filter(r => Number.isFinite(r[0]) && Number.isFinite(r[1]));
  const marks: CurveMark[] = [];
  const lab = (name: string, lfK: string, lK: string) => `${name} ${sigText(Number(dSI?.[lfK]), 3)} · ${sigText(Number(dSI?.[lK]), 4)} mm`;
  if (dUS && dUS.local_detected !== false && dUS.Lcrl > 0 && dUS.LF_local > 0) { marks.push({ k: 'local', L: dUS.Lcrl, lf: dUS.LF_local, label: lab('국부', 'LF_local', 'Lcrl') }); }
  if (dUS && dUS.dist_detected !== false && dUS.Lcrd > 0 && dUS.LF_dist > 0) { marks.push({ k: 'dist', L: dUS.Lcrd, lf: dUS.LF_dist, label: lab('뒤틀림', 'LF_dist', 'Lcrd') }); }
  const W = Math.max(420, Math.round(size.w)), H = Math.max(320, Math.round(size.h - 40));
  // 이 그림은 고른 단면의 것 — 해석 탭(S1)의 모드 형상 고르기와 섞이지 않게 반파장을 고르는 칸을 뺀다
  const svg = curveSvg({ w: W, h: H, rows, marks, higher: false, yLabel: 'LF = Mxxcr / My' }).replace(/ data-pick="len:\d+"/g, '');
  const pickS = `<span class="vsel" data-psec-picker${tip('단면을 고른다 — 그 단면의 서명곡선 · 좌굴값')}>${p.us.map((x: any) => `<span class="${String(x.id) === id ? 'on' : ''}" data-psec-pick="${esc(String(x.id))}">${esc(String(x.id))}</span>`).join('')}</span>`;
  const pickC = `<span class="vsel" data-psec-curves>${opts.map(([k, t]) => `<span class="${k === c ? 'on' : ''}" data-psec-curve="${esc(k)}">${esc(t)}</span>`).join('')}</span>`;
  return `<div class="dv" data-draw="psec-curve" data-psec="${esc(id)}" data-psec-curve-on="${esc(c)}" data-points="${rows.length}" data-src-dsm="${esc(dsrc)}">${svg}`
    + `<div class="hud tl">${pickS}${pickC}</div>`
    + `<div class="hud bl"><span class="cap"${tip('퍼린 결과의 단면 블록(호스트) — 반파장 · 하중계수 그대로. 해석 탭의 좌굴 해석은 S1(모델)의 것이다(결정 S8)')}>${esc(id)} · S-S 서명곡선(설계 Fy ${sigText(si(cv?.fy_reference, 'stress') ?? NaN, 4)} MPa) · ${rows.length}점</span></div></div>`;
}

// ── 랩 접합 ─────────────────────────────────────────────────────────
const GOV_KO: Record<string, string> = { fastener_bearing_tilting: '패스너 지압 · 기울어짐', lever_arm: '우력의 팔', block_shear: '블록전단', flexure_local: '랩의 휨(국부)', flexure_distortional: '랩의 휨(뒤틀림)', bending_shear: '휨 + 전단' };
/** 정보 창 — 두 단면을 잇는 랩(엔진의 lap_two_members) · 어느 랩(지점을 정하지 않아 지배 랩을 고름). 해당 없으면 '' */
export function lapTwoBlock(us: any, s: any): string {
  if (!us || typeof us !== 'object') { return ''; }
  const ss = us.section_source && typeof us.section_source === 'object' ? us.section_source : null;
  const which = ss?.support_defaulted === true
    ? `<div class="notice" data-lap-auto="${esc(String(ss.support ?? ''))}"${tip('검토 상태의 「랩 지점」 이 비어 있어 호스트가 마지막 퍼린 결과의 지배 랩을 골랐다')}><b>어느 랩</b> 지점 ${esc(String(ss.support ?? '—'))} — 랩 지점을 정하지 않아 마지막 퍼린 결과의 지배 랩을 골랐다</div>` : '';
  if (us.lap_two_members !== true) { return which ? sec('어느 랩', which, '', '', ' data-lap-which') : ''; }
  const ms: any[] = Array.isArray(us.lap_members) ? us.lap_members : [];
  const ids: any[] = Array.isArray(ss?.members) ? ss.members : [];
  // 부재가 열(정보 창이 좁다) — 칸마다 data-m(부재) · data-f(무엇). Se · Ix 는 큰 수라 ×10ⁿ 과 단위를 칸에
  const col = (f: string, html: (x: any, j: number, p: string) => string) => ms.map((m: any, j: number) => `<td class="r" data-m="${j + 1}" data-f="${f}">${html(s?.lap_members?.[j] ?? m, j, `lap:lap_members.${j}.`)}</td>`).join('');
  const line = (t: string, f: string, html: (x: any, j: number, p: string) => string, why = '') => `<tr data-lap-two-row="${f}"><td${tip(why)}>${t}</td>${col(f, html)}</tr>`;
  const big = (v: unknown, src: string, kind: Kind) => (typeof v === 'number' && Number.isFinite(v) ? num(v, { src, kind, sig: 4 }) : '<span class="faint">—</span>');
  const rows = line('단면', 'sec', (_x, j) => (ids[j]?.section_id ? esc(String(ids[j].section_id)) : '<span class="faint">—</span>'))
    + line('경간', 'span', (_x, j) => (Number.isInteger(ids[j]?.span) ? String(ids[j].span + 1) : '—'))
    + line('t <span class="u">mm</span>', 't', (x, _j, p) => n4(x?.t, `${p}t`, 'length'))
    + line('d <span class="u">mm</span>', 'd', (x, _j, p) => n4(x?.d, `${p}d`, 'length'))
    + line('Se', 'Se', (x, _j, p) => big(x?.Se, `${p}Se`, 'modulus'))
    + line('Ix', 'Ixx', (x, _j, p) => big(x?.Ixx, `${p}Ixx`, 'inertia'), '강성의 몫(참고)에만 쓴다')
    + line('Mnℓ <span class="u">kN·m</span>', 'Mnl', (x, _j, p) => n4(x?.Mnl, `${p}Mnl`, 'moment'), '그 부재의 국부 공칭 휨강도 Mnℓ(엔진) — 랩의 휨은 두 부재의 합')
    + line('Vn <span class="u">kN</span>', 'Vn', (x, _j, p) => n4(x?.Vn, `${p}Vn`, 'force'), '그 부재의 공칭 전단강도 Vn(엔진) — §H2 는 두 부재의 합');
  const gov = us.member_governing && typeof us.member_governing === 'object' ? us.member_governing : {};
  const govOf = (g: unknown) => (g === 'sum' ? '두 부재 강도의 합' : g === 'both' ? '두 부재 같음' : `부재 ${esc(String(g))}`);
  const govTxt = Object.entries(GOV_KO).filter(([k]) => gov[k] !== undefined && gov[k] !== null)
    .map(([k, t]) => `<span data-member-gov="${esc(k)}"${gov[k] === 'sum' ? ' data-by-sum' : ''}>${esc(t)} — ${govOf(gov[k])}</span>`).join(' · ');
  // 결정 S3′: 랩의 휨 Mn,lap = Mnℓ,1 + Mnℓ,2(§H2 도 합한 강도) — 판정은 위 「판정비」 의 랩 구간 휨 · 검토 항목
  const sumHtml = us.strength_basis === 'sum_of_strengths' && typeof us.Mn_lap === 'number'
    ? `<div class="dim" data-lap-sum${tip(`${SUM_BASIS} — 랩의 휨(국부)과 휨 + 전단(§H2)을 두 부재 강도의 합으로 엔진이 판정한다. 패스너는 얇은 판, 우력의 팔 · 블록전단은 불리한 부재`)}>`
      + `랩의 휨: Mn,lap = Mnℓ,1 + Mnℓ,2 = ${n4(s?.Mn_lap, 'lap:Mn_lap', 'moment')} <span class="u">kN·m</span> · φMn,lap ${n4(s?.phi_Mn_lap, 'lap:phi_Mn_lap', 'moment')} <span class="u">kN·m</span> — ${esc(SUM_BASIS)}</div>` : '';
  const ref = us.flexure_reference_stiffness_share;
  const rs = s?.flexure_reference_stiffness_share ?? ref;
  const why = '참고만 — 랩의 휨 · §H2 는 두 부재 강도의 합으로 판정한다(결정 S3′). 이 비는 판정비가 아니다';
  const bs = (Array.isArray(us.design_checks) ? us.design_checks : []).find((c: any) => c?.id === 'lap.bending_shear')?.reference_stiffness_share;
  const shares = Array.isArray(rs?.shares) ? rs.shares.map((v: unknown, j: number) => n4(v, `lap:flexure_reference_stiffness_share.shares.${j}`, 'none')).join(' | ') : '';
  const refHtml = ref && typeof ref.dcr === 'number'
    ? `<div class="dim" data-lap-stiff-ref>참고 — 판정에 쓰지 않음: 강성(Ix)의 몫${shares ? ` ${shares}` : ''}으로 본 값 — 휨 ${refRatio(ref.dcr, why)}`
      + `${typeof rs?.phi_Mn_lap === 'number' ? ` <span class="faint">(φMn ${n4(rs.phi_Mn_lap, 'lap:flexure_reference_stiffness_share.phi_Mn_lap', 'moment')} kN·m${Number.isInteger(ref.governing_member) ? ` · 부재 ${ref.governing_member}` : ''})</span>` : ''}`
      + `${bs && typeof bs.ratio === 'number' ? ` · 휨 + 전단 ${refRatio(bs.ratio, why)}` : ''}</div>` : '';
  return sec('랩 — 두 부재', which
    + `<table class="t" data-table="lap-two"><thead><tr><th></th>${ms.map((_m: any, j: number) => `<th class="r" data-lap-two="${j + 1}">부재 ${j + 1}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
    + sumHtml
    + (govTxt ? `<div class="dim" data-member-governing>정한 것: ${govTxt}</div>` : '')
    + refHtml, '', '두 단면을 잇는 랩(결정 S1 · S3′ · S5) — 랩의 휨 · §H2 는 두 부재 강도의 합, 지압은 얇은 판, 우력의 팔은 불리한 쪽(엔진)', ' data-lap-two-block');
}
