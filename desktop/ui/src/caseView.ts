/**
 * 모델 탭의 부재 · 하중 · 설계 조건 · 접합부 · 재료(설계 강도) — 호스트의 검토 상태(`get_case_inputs`, K2)를 그대로 보인다.
 *
 * 값: `state.caseIn.inputs[key]`(US) → units.caseSI(제품의 caseValueToSI, 표의 단위 종류)로 SI. 수마다 `data-src="case:inputs.<key>"`.
 * 경간 표: `spans.spans[i]`(ft → m) · `spans.supports[i]` · `spans.lapsPerSupport[i].left|right`(ft → m).
 * 출처: `sources[key]` — 기본값 · 지정 · AI · 파일 · 하중 해석 · 연동(화면이 다른 칸을 따라 채움). AI 가 그 도구의 묶음에서 주지 않은 칸은 값이 null 이고
 * 출처가 ai — 「AI: 주지 않음」. 그 밖의 null 은 「빈칸」(입력 없음 — 지어낸 값을 쓰지 않는다).
 */
import { BRANCH_OF, CASE_FIELDS, CASE_KO, CASE_SOURCE, caseTag, fieldOf, GROUP_KO, OPTION_KO } from './caseFields';
const CASE_SOURCE_KO = (s: string): string => CASE_SOURCE[s]?.t ?? s;
import { esc, tip } from './dom';
import { none, num, sigText } from './format';
import { state } from './store';
import { caseSI, si, type Kind } from './units';

export type Branch = 'mem' | 'ld' | 'dc' | 'cj' | 'mat';

const ci = () => state.caseIn;
export const caseReady = (): boolean => !!ci()?.inputs;
const srcOf = (key: string): string | undefined => ci()?.sources?.[key];
export const blankByAi = (key: string): boolean => ci()?.inputs?.[key] === null && srcOf(key) === 'ai';

/** 값 하나(SI) — 수 · 선택지 · 체크 · 목록. null 이면 「AI: 주지 않음」 또는 「빈칸」 */
export function caseValue(key: string, o: { unit?: boolean; sig?: number } = {}): string {
  const f = fieldOf(key);
  const raw = ci()?.inputs?.[key];
  if (raw === null || raw === undefined || raw === '') {
    return blankByAi(key) ? `<span class="none" data-blank="ai"${tip('AI 가 이 도구의 입력 묶음에서 주지 않았다 — 빈칸(엔진이 그 칸 없이 계산했다)')}>AI: 주지 않음</span>` : none('빈칸', '입력 없음');
  }
  // 수가 아닌 값(체크 · 선택지)은 data-src 를 달지 않는다(수 대조의 대상이 아니다) — 시험은 data-ckey · data-text · data-bool 로 대조한다
  if (f?.type === 'chk' || typeof raw === 'boolean') { return `<span data-ckey="${esc(key)}" data-bool="${raw ? 1 : 0}">${raw ? '켬' : '끔'}</span>`; }
  if (f?.type === 'sel' || typeof raw === 'string') {
    const s = String(raw);
    return `<span data-ckey="${esc(key)}" data-text="${esc(s)}">${esc(OPTION_KO[s] ? `${OPTION_KO[s]} · ${s}` : s)}</span>`;
  }
  const { v, kind } = caseSI(raw, f?.kind ?? null);
  if (Array.isArray(v)) {
    return v.length ? v.map((x, i) => num(typeof x === 'number' ? x : null, { src: `case:inputs.${key}.${i}`, kind, unit: false, sig: o.sig ?? 4 })).join(', ') + (kind !== 'none' ? ` <span class="u">${unitLabel(kind)}</span>` : '') : none('없음');
  }
  return num(typeof v === 'number' ? v : null, { src: `case:inputs.${key}`, kind, unit: o.unit, sig: o.sig ?? 4 });
}

const LABEL_FALLBACK = (k: string) => CASE_KO[k] ?? k;
function unitLabel(kind: Kind): string {
  const m: Partial<Record<Kind, string>> = { length: 'mm', length_ft: 'm', stress: 'MPa', force: 'kN', moment: 'kN·m', pressure: 'kPa', inertia: 'mm⁴', rot_stiff: 'kN·m/rad/m', lat_stiff: 'kN/m/m', density: 'kg/m³' };
  return m[kind] ?? '';
}

/** 경간 표의 수(ft → m) */
function spanNum(v: unknown, path: string): string {
  return num(si(v, 'length_ft'), { src: `case:spans.${path}`, kind: 'length_ft', unit: false, sig: 3 });
}

/** 트리의 값 글(짧게) — 가지와 아이 */
export function branchSummary(b: Branch): string {
  const x = ci();
  if (!x?.inputs) { return ''; }
  const I = x.inputs;
  if (b === 'mem') { return [OPTION_KO[I.memberType] ?? I.memberType, OPTION_KO[I.spanType] ?? I.spanType].filter(Boolean).join(' · '); }
  if (b === 'ld') { return String(['loadD', 'loadLr', 'loadS', 'loadWu', 'loadWp', 'loadL'].filter(k => typeof I[k] === 'number' && I[k] !== 0).length); }
  if (b === 'dc') { return String(I.designMethod ?? ''); }
  if (b === 'cj') { return [OPTION_KO[I.connFastenerType] ?? I.connFastenerType, I.connSingleType ? (OPTION_KO[I.connSingleType] ?? I.connSingleType) : ''].filter(Boolean).join(' · '); }
  return String(I.presteelGrade ?? '');
}

/** 트리 아이(키 · 이름 · 값 · 출처) */
export function branchKids(b: Branch): Array<{ k: string; t: string; vHtml: string; src?: string }> {
  const x = ci();
  if (!x?.inputs) { return []; }
  const S = x.spans ?? {};
  const kid = (key: string, label = LABEL_FALLBACK(key)) => ({ k: `case:${key}`, t: label, vHtml: caseValue(key), src: srcOf(key) });
  if (b === 'mem') {
    const spans: unknown[] = Array.isArray(S.spans) ? S.spans : [];
    const laps: Array<{ left: unknown; right: unknown }> = Array.isArray(S.lapsPerSupport) ? S.lapsPerSupport : [];
    const lapN = laps.filter(l => (Number(l.left) || 0) > 0 || (Number(l.right) || 0) > 0).length;
    const firstLap = laps.find(l => (Number(l.left) || 0) > 0 || (Number(l.right) || 0) > 0);
    return [
      kid('memberType', '부재 유형'),
      { k: 'case:spans', t: '스팬', vHtml: spans.length ? spans.map((v, i) => spanNum(v, `spans.${i}`)).join(' · ') + ' <span class="u">m</span>' : none('없음'), src: srcOf('spans') },
      { k: 'case:supports', t: '지점', vHtml: esc(String((S.supports ?? []).length)), src: srcOf('supports') },
      { k: 'case:laps', t: '랩', vHtml: lapN ? `${lapN} · ${spanNum(firstLap!.left, `lapsPerSupport.${laps.indexOf(firstLap!)}.left`)}/${spanNum(firstLap!.right, `lapsPerSupport.${laps.indexOf(firstLap!)}.right`)} <span class="u">m</span>` : '0', src: srcOf('lapsPerSupport') },
      kid('spacing', '간격'), kid('deckType', '데크'),
      // 랩 구간의 구속 진술 — 호스트의 검토 상태에 생기면(출처와 함께) 보인다
      ...('lap_restrained' in x.inputs ? [kid('lap_restrained', '랩 구속 진술')] : []),
    ];
  }
  if (b === 'ld') { return ['loadD', 'loadLr', 'loadS', 'loadWu', 'loadWp', 'loadL'].map(k => kid(k, CASE_KO[k].split(' ')[0])).concat([kid('chkPatternLoading', '부분재하')]); }
  if (b === 'dc') { return [kid('designMethod', '설계법'), kid('Lb', 'Lb'), kid('Cb', 'Cb'), kid('Mux', 'Mux'), kid('Pu', 'Pu'), kid('Vu', 'Vu'), kid('wcN', '지압 길이 N')]; }
  if (b === 'cj') { return [kid('connFastenerType', '랩 패스너'), ...('connLapSupport' in x.inputs ? [kid('connLapSupport', '랩 지점')] : []), kid('connLapLeft', '랩 좌'), kid('connLapRight', '랩 우'), kid('connNRows', '열 수'), kid('connSingleType', '단일 접합')]; }
  return [kid('fy', '설계 Fy'), kid('fu', '설계 Fu'), kid('presteelGrade', '강종')];
}

const BRANCH_GROUPS: Record<Branch, string[]> = {
  mem: ['member', 'deck'], ld: ['loads'], dc: ['method', 'design', 'required', 'options', 'webCrippling'], cj: ['lap', 'connection'], mat: ['material'],
};
export const BRANCH_TITLE: Record<Branch, string> = { mem: '부재', ld: '하중', dc: '설계 조건', cj: '접합부', mat: '재료 · 설계 강도' };
void BRANCH_OF;

/** 정보 창 — 그 가지의 묶음마다 [이름 | 값 | 출처] 표(고른 키는 강조) */
export function caseTables(b: Branch, focus: string | null): string {
  const x = ci();
  if (!x?.inputs) { return `<div class="sec"><h4>검토 상태</h4>${none('검토 상태를 읽지 못함', state.caseErr)}</div>`; }
  const row = (key: string) => `<tr data-k="case:${esc(key)}"${focus === key ? ' class="on"' : ''}><td>${esc(LABEL_FALLBACK(key))}</td><td class="r">${caseValue(key)}</td><td class="src">${caseTag(srcOf(key), blankByAi(key))}</td></tr>`;
  let html = '';
  if (b === 'mem') {
    const S = x.spans ?? {};
    const spans: unknown[] = Array.isArray(S.spans) ? S.spans : [];
    const sup: string[] = Array.isArray(S.supports) ? S.supports : [];
    const laps: Array<{ left: unknown; right: unknown }> = Array.isArray(S.lapsPerSupport) ? S.lapsPerSupport : [];
    const rows = sup.map((s, i) => `<tr data-k="case:supports"><td>${String.fromCharCode(65 + i)}</td><td>${esc(s)}</td><td class="r">${i < spans.length ? spanNum(spans[i], `spans.${i}`) : '<span class="faint">—</span>'}</td>`
      + `<td class="r">${laps[i]?.left === null || laps[i]?.left === undefined ? '<span class="faint">—</span>' : spanNum(laps[i].left, `lapsPerSupport.${i}.left`)}</td>`
      + `<td class="r">${laps[i]?.right === null || laps[i]?.right === undefined ? '<span class="faint">—</span>' : spanNum(laps[i].right, `lapsPerSupport.${i}.right`)}</td></tr>`).join('');
    html += `<div class="sec"><h4${tip('검토 상태의 경간 표(m) — spans · supports · lapsPerSupport')}>경간 · 지점 · 랩<span class="sp"></span>${caseTag(srcOf('spans'))}</h4>`
      + `<table class="t etab" data-table="case-spans"><thead><tr><th>지점</th><th>조건</th><th class="r">스팬 m</th><th class="r">랩 좌 m</th><th class="r">랩 우 m</th></tr></thead><tbody>${rows || `<tr><td colspan="5">${none('없음')}</td></tr>`}</tbody></table></div>`;
  }
  // 표(designState FIELDS)에 아직 없는데 호스트의 상태에 있는 랩 구간 구속 진술 — 부재 · 접합부 가지에 따로(표에 생기면 그 묶음에서)
  if ((b === 'mem' || b === 'cj') && 'lap_restrained' in x.inputs && !CASE_FIELDS.some(f => f.key === 'lap_restrained')) {
    html += `<div class="sec"><h4${tip('없으면 엔진이 퍼린의 랩 구간과 랩 검토를 「검토 안 함 — 진술 없음」으로 낸다')}>랩 구간</h4><table class="t" data-table="case-lapRestraint"><tbody>${row('lap_restrained')}</tbody></table></div>`;
  }
  for (const g of BRANCH_GROUPS[b]) {
    const keys = CASE_FIELDS.filter(f => f.group === g).map(f => f.key);
    if (!keys.length) { continue; }
    html += `<div class="sec"><h4>${esc(GROUP_KO[g] ?? g)}</h4><table class="t" data-table="case-${esc(g)}"><tbody>${keys.map(row).join('')}</tbody></table></div>`;
  }
  return html;
}

/** AI 가 정했는데 사람 값을 바꾼 것 · MCP 에만 있는 인자 — 정보 창 아래 */
export function caseNotes(): string {
  const x = ci();
  if (!x) { return ''; }
  const rp = state.caseReplaced;
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') { return '빈칸'; }
    if (typeof v !== 'number' && !Array.isArray(v)) { return String(OPTION_KO[String(v)] ?? v); }
    const { v: sv, kind } = caseSI(v, fieldOf(k)?.kind ?? null);
    return `${Array.isArray(sv) ? sv.join(', ') : sigText(Number(sv), 4)}${kind !== 'none' ? ` ${unitLabel(kind)}` : ''}`;
  };
  const rpHtml = rp.length ? `<div class="sec" data-replaced="${rp.length}"><h4${tip('AI 가 MCP 도구로 묶음을 정하면서 사람(지정) · 파일 · 하중 해석의 값을 바꾼 것 — 호스트 상태 두 판의 차이. 되돌리는 길은 변경 기록(R2)부터')}>AI 가 바꾼 사람의 값</h4>`
    + `<ul class="notes">${rp.map(r => `<li data-key="${esc(r.key)}">${esc(LABEL_FALLBACK(r.key))}: ${esc(show(r.key, r.was))}(${esc(CASE_SOURCE_KO(r.wasSrc))}) → ${esc(show(r.key, r.now))}(AI) <span class="faint">판 ${r.rev}</span></li>`).join('')}</ul></div>` : '';
  const mo = x.mcp_only && typeof x.mcp_only === 'object' ? Object.entries(x.mcp_only) : [];
  return rpHtml + (mo.length ? `<div class="sec"><h4${tip('화면 칸이 없는 MCP 인자 — 그 도구를 다시 부르면 통째로 바뀐다')}>MCP 에만 있는 인자</h4><ul class="notes">${mo.map(([tool, args]) => `<li>${esc(tool)}: ${esc(JSON.stringify(args))}</li>`).join('')}</ul></div>` : '');
}
