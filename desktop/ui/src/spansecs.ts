/**
 * 2026-11-28 결정 S1 – S8 — 경간마다 다른 퍼린 단면을 검토 화면에(작업문서 docs/implementation/20261128-span-sections-worklog.md 의 H 기록).
 * 화면은 계산하지 않는다 — 호스트의 검토 상태 · 퍼린 결과 · 랩 결과를 그대로 보인다.
 *
 *  - 입력: 경간 표의 넷째 키 `spans.spanSections`(「단면」)와 `sections`(「단면 목록」 — S2 부터, US 인치. S1 은 늘 모델).
 *    단면마다 Ix 는 호스트가 편집 화면의 「단면 목록」 에 보낸 마지막 `sectionListInfo {info: {S2: {Ixx, A} | {error}}}`(다리가 남긴 것),
 *    S1 의 Ix 는 지금 모델의 단면 성질. 모든 경간이 S1 이고 목록이 비면(`designState.sectionsAreDefault`) 아무것도 더하지 않는다.
 *  - 퍼린 결과(경간마다 단면일 때만): 구간의 `section_id` · 랩의 두 부재(`lap_members` — 단면 · 경간 · 역할 · 몫 · Mu · Vu · 판정비 · 판정,
 *    `governing_member`, `share_basis`, `reference_sum_of_strengths` — 참고, 판정에 쓰지 않음), 단면이 바뀌는 구간(`sections_checked` ·
 *    `section_rule`), 평가하지 못한 구간(`not_evaluated_reason` — 합격이 아니다). 단면마다의 블록(`sections[]` — 성질 · 좌굴값 · 데크 강성 · 서명곡선).
 *  - 랩 접합: 두 단면을 잇는 랩(`lap_two_members` · `lap_members` · `member_governing` · `flexure_reference_sum_of_strengths`),
 *    지점을 정하지 않아 지배 랩을 고른 것(`section_source.support_defaulted`).
 *
 * 판정: true OK · false NG · 그 밖 「판정 없음」(합격이 아니다). 참고 비는 `data-ratio-ref`(판정비 `data-ratio` 가 아니다).
 */
// @ts-expect-error — UMD(CommonJS) 모듈, 형 정보 없음. 규칙 하나(sectionsAreDefault)만 읽는다
import * as DS from '../../../webview/js/designState.js';
import { esc, tip } from './dom';
import { none, num, ratio, refRatio, sigText, verdictOf } from './format';
import { TEMPLATE_KO } from './names';
import { fieldText } from './notices';
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
const BASIS: Record<string, string> = { stiffness_Ix: '강성(Ix)의 비 — M_i = M · I_i / (I_1 + I_2)' };
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
  const lines: any[] = Array.isArray(us.lap_members) ? us.lap_members : Array.isArray(us.sections_checked) ? us.sections_checked : [];
  const key = Array.isArray(us.lap_members) ? 'lap_members' : 'sections_checked';
  const lap = key === 'lap_members';
  const gov = lap && Number.isInteger(us.governing_member) ? us.governing_member - 1 : -1;
  const govSec = !lap && lines.length > 1 ? lines.findIndex((m: any) => m?.section_id === us.section_id && m?.pass === us.result?.pass && m?.utilization === us.result?.utilization) : -1;
  const body = lines.map((m: any, j: number) => {
    const ms = s[key]?.[j] ?? m;
    const v = vText(m?.pass);
    const isGov = j === gov || j === govSec;
    return `<tr data-${lap ? 'lap-member' : 'sec-checked'}="${j + 1}"${isGov ? ' data-gov="1" class="on"' : ''}><td style="white-space:nowrap">${lap ? `${j + 1}` : ''}${isGov ? ` <span class="tag"${tip(lap ? '구간의 판정과 판정비를 정한 부재(불합격 → 판정 없음 → 큰 판정비 차례)' : '구간의 판정을 정한 단면')}>지배</span>` : ''}</td>`
      + `<td>${secId(m?.section_id)}</td><td class="r">${Number.isInteger(m?.span) ? m.span + 1 : '—'}</td>`
      + (lap ? `<td data-role="${esc(String(m?.role ?? ''))}"${tip(ROLE[String(m?.role)] ?? '')}>${esc(ROLE_SHORT[String(m?.role)] ?? String(m?.role ?? '—'))}</td><td class="r">${typeof ms?.share === 'number' ? num(ms.share, { src: `${pre}${key}.${j}.share`, kind: 'none', unit: false, sig: 4 }) : '—'}</td>` : '')
      + `<td class="r">${typeof ms?.Mu === 'number' ? num(ms.Mu, { src: `${pre}${key}.${j}.Mu`, kind: 'moment', unit: false, sig: 4 }) : '—'}</td>`
      + `<td class="r">${typeof ms?.Vu === 'number' ? num(ms.Vu, { src: `${pre}${key}.${j}.Vu`, kind: 'force', unit: false, sig: 4 }) : '—'}</td>`
      + `<td class="r">${memberRatio(m, `${pre}${key}.${j}.utilization`)}</td><td class="r verdict ${v.cls}" style="font-weight:400" data-member-verdict="${m?.pass === true ? 'ok' : m?.pass === false ? 'ng' : 'none'}">${v.text}</td></tr>`;
  }).join('');
  const tbl = lines.length ? `<table class="t" data-table="${lap ? 'lap-members' : 'sections-checked'}"><thead><tr><th>${lap ? '부재' : ''}</th><th>단면</th><th class="r">경간</th>${lap ? '<th>역할</th><th class="r">몫</th>' : ''}<th class="r">Mu kN·m</th><th class="r">Vu kN</th><th class="r">비</th><th class="r">판정</th></tr></thead><tbody>${body}</tbody></table>` : '';
  const basis = lap && us.share_basis ? `<div class="dim" data-share-basis="${esc(us.share_basis)}"${tip('결정 S3 — 기준에 식이 없는 설계 가정. 두 단면이 같으면 절반씩(지금까지 그대로)')}>몫: ${esc(BASIS[String(us.share_basis)] ?? String(us.share_basis))}</div>` : '';
  const ref = us.reference_sum_of_strengths;
  const refHtml = lap && ref && typeof ref.ratio === 'number'
    ? `<div class="dim" data-sum-ref${tip(fieldText(ref, 'label') || '설계 매뉴얼 II-1A / II-2A 의 가정 (c) — 겹친 두 부재 강도의 합')}>참고 — 판정에 쓰지 않음: 두 부재 강도의 합(설계 매뉴얼 II-1A · II-2A 의 가정 (c)) M / (Ma,1 + Ma,2) = ${refRatio(ref.ratio, '참고만 — 판정은 강성의 몫으로(결정 S3)')}`
      + `${typeof s.reference_sum_of_strengths?.design_strength_sum === 'number' ? ` <span class="faint">(Ma,1 + Ma,2 = ${num(s.reference_sum_of_strengths.design_strength_sum, { src: `${pre}reference_sum_of_strengths.design_strength_sum`, kind: 'moment', sig: 4 })})</span>` : ''}</div>` : '';
  const depth = lap && us.depth_mismatch === true ? `<div class="notice" data-depth-mismatch${tip('결정 S4 — 설계 매뉴얼의 가정은 같은 춤의 겹친 부재다')}>두 부재의 춤이 다르다 — 이 랩 구간은 평가하지 않는다(판정 없음 · 합격이 아니다)</div>` : '';
  return sec(lap ? '단면 · 랩의 두 부재' : '단면 — 경간마다', table(rows.join('')) + depth + tbl + basis + refHtml, '',
    '경간마다 다른 퍼린 단면(결정 S1 · S3 · S4) — 호스트의 퍼린 결과 그대로', ` data-region-sec="${esc(String(us.id ?? ri))}"`);
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

/** 정보 창 — 단면 하나(성질 · 치수 · 좌굴값 정 · 부 · 데크 강성마다 · 경간의 데크 강성) */
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
  const byDeck = Array.isArray(s.dsm_pos_by_deck) ? s.dsm_pos_by_deck : [];
  const deck = Array.isArray(s.deck) ? s.deck : [];
  const deckRows = deck.map((d: any, j: number) => row_(`경간 ${Number.isInteger(d?.span) ? d.span + 1 : '—'}`, `kφ ${num(d?.kphi, { src: `${pre}deck.${j}.kphi`, kind: 'rot_stiff', sig: 4 })} · kx ${num(d?.kx, { src: `${pre}deck.${j}.kx`, kind: 'lat_stiff', sig: 4 })}`, '<span class="tag drv">데크</span>')).join('');
  const spans = (Array.isArray(us.spans) ? us.spans : []).map((j: number) => j + 1).join(', ');
  return `<div class="hd"><div class="k">결과 · 퍼린 단면<span class="sp"></span></div><div class="ttl" data-psec-title="${esc(id)}">${esc(id)}${us.name ? ` · ${esc(us.name)}` : us.source === 'model' ? ' · 모델' : ''}</div>`
    + `<div class="dim">${esc(TEMPLATE_KO[String(us.template)] ?? String(us.template ?? ''))} · 쓰는 경간 ${esc(spans || '없음')}</div></div>`
    + sec('치수', table(params || row_('치수', none('없음'), '')), '', '그 단면의 템플릿 치수(바깥-바깥, r 은 안쪽 반지름)')
    + sec('단면 성질', table(props || row_('성질', none('없음'), '')), '', '호스트가 그 치수로 만든 단면의 성질')
    + sec(byDeck.length ? '좌굴값 — 정모멘트(+M, 첫 데크 강성)' : '좌굴값 — 정모멘트(+M)', table(dsmRows(s.dsm_pos, `${pre}dsm_pos.`)), '', 'S-S 서명곡선(설계 Fy) · 그 경간의 데크 스프링 — 정모멘트 구간이 쓴 값', ' data-psec-dsm="pos"')
    + byDeck.map((g: any, j: number) => sec(`좌굴값 — 정모멘트 · 경간 ${(Array.isArray(g?.spans) ? g.spans : []).map((x: number) => x + 1).join(', ')}`,
      table(row_('데크 강성', `kφ ${num(g?.kphi, { src: `${pre}dsm_pos_by_deck.${j}.kphi`, kind: 'rot_stiff', sig: 4 })} · kx ${num(g?.kx, { src: `${pre}dsm_pos_by_deck.${j}.kx`, kind: 'lat_stiff', sig: 4 })}`, '') + dsmRows(g?.dsm, `${pre}dsm_pos_by_deck.${j}.dsm.`)),
      '', '같은 단면이라도 경간마다 데크 강성이 달라 정모멘트 좌굴값을 그 강성마다 풀었다', ` data-psec-dsm="deck:${j}"`)).join('')
    + sec('좌굴값 — 부모멘트(−M)', table(dsmRows(s.dsm_neg, `${pre}dsm_neg.`)), '', 'S-S 서명곡선(설계 Fy) · 스프링 없음 — 부모멘트 · 랩 구간이 쓴 값', ' data-psec-dsm="neg"')
    + (deckRows ? sec('데크 강성 — 경간마다', table(deckRows), '', '그 단면의 t · B 로 경간마다(결정 S7)') : '')
    + `<div class="sec"><span class="faint">해석 탭의 좌굴 해석은 S1(모델)의 것이다(결정 S8) — 이 단면의 서명곡선은 가운데 그림</span></div>`;
}

/** 가운데 — 고른 단면의 서명곡선(정 · 부 · 데크 강성마다) · 단면 고르기 */
export const psecSel: { curve: string } = { curve: 'pos' };
export function psecView(key: string, size: { w: number; h: number }): string {
  const p = state.psec;
  if (!p) { return `<div class="dv ph"><div class="ph-box"><b>경간마다 단면 없음</b><span>지금 퍼린 결과는 모든 경간이 S1 이다</span></div></div>`; }
  const id = psecIdOf(key);
  const i = idxOf(id);
  const us = p.us[i], s = p.si[i] ?? us;
  if (!us) { return `<div class="dv ph"><div class="ph-box"><b>${esc(id)} 없음</b><span>지금 퍼린 결과에 이 단면이 없다</span></div></div>`; }
  const byDeck: any[] = Array.isArray(us.curves?.pos_by_deck) ? us.curves.pos_by_deck : [];
  const opts: Array<[string, string]> = [['pos', '정모멘트 +M'], ...byDeck.map((g: any, j: number): [string, string] => [`deck:${j}`, `+M · 경간 ${(Array.isArray(g?.spans) ? g.spans : []).map((x: number) => x + 1).join(', ')}`]), ['neg', '부모멘트 −M']];
  if (!opts.some(([k]) => k === psecSel.curve)) { psecSel.curve = 'pos'; }
  const c = psecSel.curve;
  const dj = c.startsWith('deck:') ? Number(c.slice(5)) : -1;
  const cv = dj >= 0 ? byDeck[dj] : us.curves?.[c];
  const dUS = dj >= 0 ? us.dsm_pos_by_deck?.[dj]?.dsm : c === 'neg' ? us.dsm_neg : us.dsm_pos;
  const dSI = dj >= 0 ? s.dsm_pos_by_deck?.[dj]?.dsm : c === 'neg' ? s.dsm_neg : s.dsm_pos;
  const dsrc = dj >= 0 ? `purlin:sections.${i}.dsm_pos_by_deck.${dj}.dsm.` : `purlin:sections.${i}.dsm_${c === 'neg' ? 'neg' : 'pos'}.`;
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
  const rows = ms.map((m: any, j: number) => {
    const x = s?.lap_members?.[j] ?? m;
    const sid = ids[j]?.section_id;
    return `<tr data-lap-two="${j + 1}"><td>부재 ${j + 1}</td><td>${sid ? esc(String(sid)) : '<span class="faint">—</span>'}</td><td class="r">${Number.isInteger(ids[j]?.span) ? ids[j].span + 1 : '—'}</td>`
      + `<td class="r">${num(x?.t, { src: `lap:lap_members.${j}.t`, kind: 'length', unit: false, sig: 4 })}</td><td class="r">${num(x?.d, { src: `lap:lap_members.${j}.d`, kind: 'length', unit: false, sig: 4 })}</td>`
      + `<td class="r">${num(x?.Se, { src: `lap:lap_members.${j}.Se`, kind: 'modulus', unit: false, sig: 4 })}</td><td class="r">${num(x?.Ixx, { src: `lap:lap_members.${j}.Ixx`, kind: 'inertia', unit: false, sig: 4 })}</td>`
      + `<td class="r">${typeof x?.share === 'number' ? num(x.share, { src: `lap:lap_members.${j}.share`, kind: 'none', unit: false, sig: 4 }) : '—'}</td></tr>`;
  }).join('');
  const gov = us.member_governing && typeof us.member_governing === 'object' ? us.member_governing : {};
  const govTxt = Object.entries(GOV_KO).filter(([k]) => gov[k] !== undefined && gov[k] !== null)
    .map(([k, t]) => `<span data-member-gov="${esc(k)}">${esc(t)} — ${gov[k] === 'both' ? '두 부재 같음' : `부재 ${esc(String(gov[k]))}`}</span>`).join(' · ');
  const ref = us.flexure_reference_sum_of_strengths;
  const refHtml = ref && typeof ref.dcr === 'number'
    ? `<div class="dim" data-lap-sum-ref>참고 — 판정에 쓰지 않음: 두 부재 강도의 합(설계 매뉴얼의 가정 (c)) ${refRatio(ref.dcr, '참고만 — 랩의 휨은 강성의 몫으로 부재마다 판정한다(결정 S3)')}`
      + `${typeof s?.flexure_reference_sum_of_strengths?.phi_Mn_lap === 'number' ? ` <span class="faint">(설계강도의 합 ${num(s.flexure_reference_sum_of_strengths.phi_Mn_lap, { src: 'lap:flexure_reference_sum_of_strengths.phi_Mn_lap', kind: 'moment', sig: 4 })})</span>` : ''}</div>` : '';
  return sec('랩 — 두 부재', which
    + `<table class="t" data-table="lap-two"><thead><tr><th></th><th>단면</th><th class="r">경간</th><th class="r">t mm</th><th class="r">d mm</th><th class="r">Se mm³</th><th class="r">Ix mm⁴</th><th class="r">몫</th></tr></thead><tbody>${rows}</tbody></table>`
    + (govTxt ? `<div class="dim" data-member-governing>정한 부재: ${govTxt}</div>` : '')
    + (us.share_basis ? `<div class="dim" data-share-basis="${esc(us.share_basis)}">몫: ${esc(BASIS[String(us.share_basis)] ?? String(us.share_basis))}</div>` : '')
    + refHtml, '', '두 단면을 잇는 랩(결정 S1 · S5) — 지압은 얇은 판, 우력의 팔은 불리한 쪽, 랩의 휨은 강성의 몫으로 부재마다(엔진)', ' data-lap-two-block');
}
