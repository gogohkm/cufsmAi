/**
 * 계산 시트(템플릿 05) — 검토 항목 하나를 엔진의 계산 과정(`design_checks[].steps`)대로 편다. **계산하지 않는다.**
 *
 * 모든 수는 그 결과 묶음을 제품 표로 SI 로 바꾼 것(`{symbol, value, quantity}` — quantity 로)이고, 시트는 그 자리를 가리키기만 한다
 * (`data-src` = 그 항목의 경로, 예 `purlin:regions.3.result.checks.1.design_checks.2.steps.4.inputs.0.value`).
 *
 *  1. 부재와 가정 — 이 항목의 단계 입력 가운데 단면 · 재료 · 좌굴 해석 · 다른 검토에서 온 것(왼쪽)과 입력 · 기본값 · 하중 해석에서 온 것(오른쪽),
 *     검토 위치(location) · 조합(combination)
 *  2. 소요강도 — 같은 검토 지점의 항목들이 쓴 소요(demand)와 조합 · 위치, 작은 모멘트도(하중 해석이 있으면, 검토 위치 표지)
 *  3. 한계상태별 계산 — 같은 지점의 항목마다 한 덩어리(엔진 순서). 고른 항목은 펼친다: 조항 · 식 칩, 단계마다
 *     [종류 | 기호식 = 대입 = 결과 | 식 번호 · 출처], 설계강도 · 판정. 나머지는 한 줄(소요 / 설계강도 · 비). 미검토 · 해당 없음은 그 까닭.
 *
 * 대입은 화면이 `expr` 의 기호 자리에 `inputs` 의 값을 놓는 것이다(보이기). 기호를 식에서 다 찾지 못하면 대입을 꾸미지 않고 입력을 나열한다.
 * 엔진의 `expr` 를 계산하지 않는다(계약 10절 — 반올림해 넘어온 입력이 있다). 결과는 늘 `result` 를 보인다.
 */
import { esc, tip } from './dom';
import { bandVar, none, num, ratio, sigText } from './format';
import { memberSvg } from './member';
import { BUCKLING_METHOD_KO, SOURCE_KO, STEP_KO, VERDICT_KO, sectionLabel } from './names';
import { allRows, POINT_KO, rowOfKey, state, type CheckRow, type Run, COMBO_KO, locWords } from './store';
import { noteLi, plainText, reasonNote, type Note } from './notices';
import { kindOfQuantity, LABEL, si } from './units';
import { caseTag, ENGINE_TO_CASE } from './caseFields';

/** 펼친 덩어리(고른 것 말고 사람이 연 것) */
const expanded = new Set<string>();
export function toggleCard(key: string): void { if (expanded.has(key)) { expanded.delete(key); } else { expanded.add(key); } }

/** `{symbol, value, quantity}`(SI) 하나 → 수 + 단위. base = 그 객체의 경로(끝에 `.`), quantity 가 어휘에 없으면 US 그대로라고 밝힌다 */
export function qnum(q: any, base: string, o: { unit?: boolean; sig?: number } = {}): string {
  // 끝없는 값(계약 3절 · 9.8 — 횡좌굴 없음 → Fcre = ∞): 숫자로 싣지 않고 SI 로 바꾸지도 않는다 — ∞
  if (q && typeof q === 'object' && q.unbounded === true) {
    return `<span class="num" data-unbounded="1" data-usrc="${esc(base)}value"${tip(q.reason ? plainText(q.reason) : '끝이 없다(엔진)')}>∞</span>`;
  }
  if (!q || typeof q !== 'object' || typeof q.value !== 'number' || !Number.isFinite(q.value)) { return none('값 없음'); }
  const kind = kindOfQuantity(q.quantity);
  if (kind === null) {
    return `${num(q.value, { src: `${base}value`, kind: 'none', unit: false, sig: o.sig ?? 4 })} <span class="u"${tip('계약의 quantity 어휘에 없는 값 — 바꾸지 않았다(엔진 값 그대로)')}>${esc(String(q.quantity ?? ''))}</span>`;
  }
  return num(q.value, { src: `${base}value`, kind, unit: o.unit !== false, sig: o.sig ?? 4 });
}

const unitOfQ = (q: any): string => { const k = kindOfQuantity(q?.quantity); return k ? LABEL[k] : ''; };

/** 엔진의 판정 → 글 */
export function verdictSpan(v: string, extra = ''): string {
  const x = VERDICT_KO[v] ?? VERDICT_KO.not_evaluated;
  return `<span class="verdict ${x.cls === 'na' ? 'un' : x.cls}" data-verdict="${esc(v)}"${extra}>${x.text}</span>`;
}

/** 출처 하나 → 꼬리표(+ 짧은 까닭) */
export function sourceTag(src: any): string {
  if (!src || typeof src !== 'object') { return ''; }
  const k = String(src.kind ?? '');
  const t = SOURCE_KO[k];
  if (!t || k === 'step' || k === 'specification') { return ''; }
  const why: string[] = [];
  if (k === 'buckling_analysis') {
    if (src.method) { why.push(BUCKLING_METHOD_KO[src.method] ?? String(src.method)); }
    if (src.half_wavelength && typeof src.half_wavelength.value === 'number') { why.push(`L ${sigText(src.half_wavelength.value, 4)} ${unitOfQ(src.half_wavelength)}`); }
    if (src.classification) { why.push(typeof src.classification === 'string' ? src.classification : 'cFSM 분류'); }
  }
  if (k === 'check' && src.id) { why.push(String(src.id)); }
  if ((k === 'engine_default' || k === 'user_input' || k === 'material') && src.note) { why.push(plainText(src.note)); }
  if (k === 'load_analysis' && src.combination) { why.push(String(src.combination)); }
  if (src.generated) { why.push('템플릿 자동 생성'); }
  return `<span class="tag ${t.cls}"${tip(t.tip)}>${t.t}</span>${why.length ? `<span class="why2">${esc(why.join(' · '))}</span>` : ''}`;
}

// ── 대입 ─────────────────────────────────────────────────────────────
const IDC = /[\p{L}\p{N}_]/u;
/**
 * 기호식의 오른쪽(`=` 뒤 — 없으면 식 전체)에서 입력 기호 자리에 그 값을 놓는다. 기호는 긴 것부터, 앞뒤가 다른 글자로 이어지지 않는 자리에서만.
 * 입력 기호 가운데 하나라도 식에서 찾지 못하면 null(꾸미지 않고 입력을 나열한다).
 */
function substitute(part: string, inputs: Array<{ symbol: string; html: string }>): string | null {
  const syms = [...inputs].filter(x => x.symbol).sort((a, b) => b.symbol.length - a.symbol.length);
  if (!syms.length) { return null; }
  const used = new Set<string>();
  const parts: Array<{ v: boolean; raw: string; html: string }> = [];
  let txt = '';
  let k = 0;
  while (k < part.length) {
    let hit: { symbol: string; html: string } | undefined;
    for (const s of syms) {
      if (!part.startsWith(s.symbol, k)) { continue; }
      const before = k > 0 ? part[k - 1] : '';
      const after = part[k + s.symbol.length] ?? '';
      if ((before && IDC.test(before)) || (after && IDC.test(after))) { continue; }
      hit = s; break;
    }
    if (hit) {
      if (txt) { parts.push({ v: false, raw: txt, html: '' }); txt = ''; }
      parts.push({ v: true, raw: hit.symbol, html: hit.html });
      used.add(hit.symbol);
      k += hit.symbol.length;
    } else { txt += part[k]; k += 1; }
  }
  if (txt) { parts.push({ v: false, raw: txt, html: '' }); }
  if (!syms.every(s => used.has(s.symbol))) { return null; }
  // 기호식의 곱(띄어 쓴 자리)은 수를 놓으면 「×」 로 — 수가 붙어 읽히지 않게(보이기만)
  const L = /[\p{L}\p{N})²³\]]$/u, R = /^[\p{L}\p{N}(√π[]/u;
  return parts.map((p, i) => {
    if (p.v) { return p.html; }
    let raw = p.raw;
    const prevV = parts[i - 1]?.v === true, nextV = parts[i + 1]?.v === true;
    if (/^\s+$/.test(raw)) { return prevV && nextV ? ' × ' : esc(raw); }
    const lead = /^\s+/.exec(raw), trail = /\s+$/.exec(raw);
    let head = '', tail = '';
    if (prevV && lead && R.test(raw.slice(lead[0].length))) { head = ' × '; raw = raw.slice(lead[0].length); }
    if (nextV && trail && L.test(raw.slice(0, raw.length - trail[0].length))) { tail = ' × '; raw = raw.slice(0, raw.length - trail[0].length); }
    return head + esc(raw) + tail;
  }).join('');
}

/** 단계 하나 → 한 줄(시트 3절의 calc 줄) */
function stepRow(st: any, si: any, base: string, k: number): string {
  const kind = String(st?.kind ?? '');
  const label = STEP_KO[kind] ?? kind;
  const ins: any[] = Array.isArray(si?.inputs) ? si.inputs : [];
  const inHtml = ins.map((q: any, m: number) => ({ symbol: String(q?.symbol ?? ''), html: `<span class="sv">${qnum(q, `${base}inputs.${m}.`, { unit: false })}</span>` }));
  const res = si?.result && typeof si.result === 'object' ? si.result : null;
  // 판정 단계의 비는 판정비 글자 규칙(NG 올림 · 그 밖 내림 — 머리의 비와 같게)
  const resHtml = !res ? '' : kind === 'verdict' && res.symbol === 'ratio' && typeof res.value === 'number'
    ? `<b>${ratio(res.value, st?.verdict === 'fail', `${base}result.value`)}</b>` : `<b>${qnum(res, `${base}result.`)}</b>`;
  const expr = typeof st?.expr === 'string' ? st.expr : '';
  const refs: string[] = [];
  if (st?.equation) { refs.push(`식 ${esc(String(st.equation))}`); }
  ins.forEach((q: any) => { const t = sourceTag(q?.source); if (t && !refs.includes(t)) { refs.push(t); } });
  if (ins.some((q: any) => q?.source?.rounded_to !== undefined || q?.rounded_to !== undefined) || st?.rounded_to !== undefined) { refs.push(`<span class="why2"${tip('엔진이 반올림한 값을 이 단계에 썼다(계약 5절) — 결과는 엔진의 값 그대로')}>반올림한 입력</span>`); }
  if (st?.note) { refs.push(`<span class="why2">${esc(plainText(st.note))}</span>`); }
  // 원문 식 자체가 US 단위로 쓰인 단계(계약 3절 · 9.9 — 예 Eq. J3.3.2-1): SI 화면은 그렇다고 밝힌다
  if (st?.expr_units === 'US') { refs.push(`<span class="tag def" data-expr-units="US"${tip(String(st.units_note ?? ''))}>US 단위로 쓴 식</span><span class="why2">${esc(String(st.units_note ?? ''))}</span>`); }
  const ref = refs.length ? `<span class="ref">${refs.join(' ')}</span>` : '';
  let body: string;
  if (kind === 'branch') {
    const holds = st?.holds === true ? '맞음' : st?.holds === false ? '아님' : '모름';
    const vals = inHtml.map(x => `${esc(x.symbol)} = ${x.html}`).join(' · ');
    body = `조건 ${esc(String(st?.condition ?? ''))}${vals ? ` (${vals})` : ''} — <b data-holds="${st?.holds === true}">${holds}</b>${st?.equation ? ` → 식 ${esc(String(st.equation))}` : ''}`;
  } else {
    // 오른쪽의 시작 — 첫 「=」 또는 「≈」(엔진이 어림식에 쓴다)
    const m = /[=≈]/.exec(expr);
    const eq = m ? m.index : -1;
    const isVerdict = kind === 'verdict';
    const rhs = eq >= 0 && !isVerdict ? expr.slice(eq + 1) : expr.replace(/\s*[≤<≥>]\s*[\d.]+\s*$/, '');
    // 「=」 가 없는 서술식(예: 「Mcrd (elastic distortional buckling moment)」)은 대입하지 않는다 — 결과와 다른 입력만 적는다
    const sub = inHtml.length && (eq >= 0 || isVerdict) ? substitute(rhs, inHtml) : null;
    if (isVerdict) {
      body = `${esc(expr)}${sub ? ` : ${sub}` : ''}${resHtml ? ` = ${resHtml}` : ''} → ${verdictSpan(String(st?.verdict ?? ''))}`;
    } else if (sub !== null) {
      body = `${esc(expr)} = ${sub}${resHtml ? ` = ${resHtml}` : ''}`;
    } else {
      const list = inHtml.filter(x => !(res && x.symbol === res.symbol && ins.length === 1)).map(x => `${esc(x.symbol)} = ${x.html}`).join(' · ');
      body = `${esc(expr || (res ? String(res.symbol) : ''))}${list ? ` <span class="faint">[${list}]</span>` : ''}${resHtml ? ` = ${resHtml}` : ''}`;
    }
  }
  return `<div class="row" data-step="${k}" data-kind="${esc(kind)}"><span>${esc(label)}</span><span>${body}${ref}</span></div>`;
}

/** 덩어리 머리의 「소요 / 설계강도」(짧게 — 단위 없이) */
function dcShort(r: CheckRow): string {
  const d = r.si?.demand, c = r.si?.capacity;
  if (!d || !c || typeof d.value !== 'number' || typeof c.value !== 'number') { return ''; }
  return `<span class="dim num">${qnum(d, `${r.src}demand.`, { unit: false, sig: 3 })} / ${qnum(c, `${r.src}capacity.`, { unit: false, sig: 3 })}</span>`;
}

function clauseChip(r: CheckRow): string {
  const eqs: string[] = Array.isArray(r.us?.equations) ? r.us.equations.map(String) : [];
  return `<span class="tag" data-clause="${esc(r.clause)}">§${esc(r.clause)}${eqs.length ? ` · 식 ${esc(eqs.join(', '))}` : ''}</span>`;
}

/** 한 덩어리 */
function card(r: CheckRow, n: string, sel: string): string {
  const open = r.key === sel || expanded.has(r.key);
  const v = r.verdict;
  const dot = v === 'pass' ? 'ok' : v === 'fail' ? 'ng' : 'un';
  const un = v === 'not_evaluated' || v === 'not_applicable';
  const steps: any[] = Array.isArray(r.us?.steps) ? r.us.steps : [];
  const stepsSI: any[] = Array.isArray(r.si?.steps) ? r.si.steps : steps;
  const cls = `card${r.governs ? ' gov' : ''}${r.key === sel ? ' on' : ''}${un ? ' un' : ''}`;
  const right = un ? `<span class="verdict un">${unText(r)}</span>`
    : `${dcShort(r)}${typeof r.ratio === 'number' ? ratio(r.ratio, v === 'fail', `${r.src}ratio`) : '<span class="faint">비 없음</span>'}${ratioFormTag(r)}`;
  const head = `<header data-card-head="${esc(r.key)}"${tip(`${r.id}${r.governs ? ' · 무리의 지배 항목(governs)' : ''}${r.counts ? '' : ' · 판정에 들지 않는다(counts: false)'}`)}>`
    + `<span class="dot ${dot}"></span><h5>${esc(n)} ${esc(r.name)}</h5>${clauseChip(r)}${r.governs ? `<span class="tag drv" data-governs-basis="${esc(String(r.us?.governs_basis ?? ''))}"${tip(governsTip(r))}>${r.us?.governs_basis === 'not_evaluated' ? '지배 — 미검토' : '지배'}</span>` : ''}`
    + `${r.counts ? '' : '<span class="tag"' + tip('적용 조건 — 판정에 들지 않는다') + '>조건</span>'}<span class="sp"></span>${right}<span class="faint">${open ? '▾' : '▸'}</span></header>`;
  let body = '';
  if (open) {
    if (un) {
      const ref = r.si?.reference;
      const rn = reasonNote(r.us);
      body = `<div class="cbody dim"><div data-reason${rn?.code ? ` data-code="${esc(rn.code)}"` : ''}>${esc(rn?.text ?? '엔진이 까닭을 적지 않았다')}</div>${highestLine(r)}`
        + (r.us?.steps_unavailable ? `<div class="why2">계산 과정 없음 — ${esc(plainText(r.us.steps_unavailable))}</div>` : '')
        + (ref && typeof ref === 'object' ? `<div class="why2" data-reference>${r.us?.out_of_scope ? `참고 — 적용 범위 밖(${esc(String(r.us.out_of_scope))})` : '참고(판정에 쓰지 않음)'}: ${ref.capacity ? `설계강도 ${qnum(ref.capacity, `${r.src}reference.capacity.`)}` : ''}${typeof ref.ratio === 'number' ? ` · 비 ${sigText(ref.ratio, 3)}` : ''}</div>` : '')
        + (steps.length ? `<div class="calc">${steps.map((st, k) => stepRow(st, stepsSI[k], `${r.src}steps.${k}.`, k)).join('')}</div>` : '')
        + '</div>';
    } else if (!steps.length) {
      body = `<div class="cbody dim">계산 과정이 없다 — ${esc(r.us?.steps_unavailable ? plainText(r.us.steps_unavailable) : '엔진이 이 항목의 단계를 내지 않았다')}. 엔진이 준 것: `
        + `${r.si?.demand ? `소요 ${qnum(r.si.demand, `${r.src}demand.`)}` : ''}${r.si?.capacity ? ` · 설계강도 ${qnum(r.si.capacity, `${r.src}capacity.`)}` : ''}${typeof r.ratio === 'number' ? ` · 비 ${ratio(r.ratio, v === 'fail', `${r.src}ratio`)}` : ''}</div>`;
    } else {
      const fin = `<div class="row" data-final><span>판정</span><span>${r.us?.ratio_form ? '원문 좌변 ' : ''}${r.si?.demand ? `${esc(String(r.si.demand.symbol ?? ''))} ${qnum(r.si.demand, `${r.src}demand.`)}` : ''}`
        + `${r.si?.capacity ? `${r.us?.ratio_form ? ' ≤ ' : ' / '}${esc(String(r.si.capacity.symbol ?? ''))} ${qnum(r.si.capacity, `${r.src}capacity.`)}` : ''}${typeof r.ratio === 'number' ? `${r.us?.ratio_form ? ', 견줄 비 ' : ' = '}<b>${ratio(r.ratio, v === 'fail', `${r.src}ratio`)}</b>${ratioFormTag(r)}` : ''} → ${verdictSpan(v)}`
        + `${((rn) => (rn ? ` <span class="why2" data-reason${rn.code ? ` data-code="${esc(rn.code)}"` : ''}>${esc(rn.text)}</span>` : ''))(reasonNote(r.us))}${r.us?.trusted === false ? ' <span class="tag def"' + tip('엔진이 이 값을 판정에 믿지 않는다(trusted: false)') + '>믿지 않는 값</span>' : ''}</span></div>`;
      // 판정 단계가 있으면 그것이 판정 줄이다 — 없을 때만 항목의 소요 / 설계강도 · 판정으로 맺는다
      const hasVerdictStep = steps.some(st => st?.kind === 'verdict');
      body = `<div class="cbody calc" data-steps="${steps.length}">${steps.map((st, k) => stepRow(st, stepsSI[k], `${r.src}steps.${k}.`, k)).join('')}${hasVerdictStep ? '' : fin}</div>`;
    }
  }
  return `<div class="${cls}" data-card="${esc(r.key)}" data-id="${esc(r.id)}" data-governs="${r.governs}" data-verdict="${esc(v)}" data-nsteps="${steps.length}">${head}${body}</div>`;
}

/** 미검토 · 해당 없음의 머리 글 — 참고 비가 있으면 「미검토 (참고 판정비 r)」, 적용 범위 밖이면 「참고 — 적용 범위 밖」(계약 4절 · 9.5 · 9.6) */
export function unText(r: CheckRow): string {
  const base = VERDICT_KO[r.verdict]?.text ?? '미검토';
  const rr = r.si?.reference?.ratio;
  if (r.us?.out_of_scope) { return `${base} — 참고 — 적용 범위 밖${typeof rr === 'number' ? ` (참고 판정비 ${sigText(rr, 3)})` : ''}`; }
  if (typeof rr === 'number') { return `${base} (참고 판정비 ${sigText(rr, 3)})`; }
  return `${base}${r.us?.reason ? ' — 까닭' : ''}`;
}

/** 비의 꼴(계약 2절 · 9.7 — 원문 좌변이 소요의 n 제곱이면 견줄 수 있는 비로 바꾼 것) */
export function ratioFormTag(r: CheckRow): string {
  return r.us?.ratio_form ? ` <span class="tag" data-ratio-form="${esc(String(r.us.ratio_form))}"${tip('원문의 좌변은 소요 / 강도의 거듭제곱이다 — 다른 비와 견줄 수 있게 바꾼 비(ratio_form)')}>비의 꼴 ${esc(String(r.us.ratio_form))}</span>` : '';
}

function governsTip(r: CheckRow): string {
  const b = String(r.us?.governs_basis ?? '');
  return b === 'not_evaluated' ? '이 무리에 평가하지 못한 항목이 있어 그것이 지배다 — 무리는 미검토(계약 4절)' : b === 'fail' ? '불합격 가운데 비가 가장 큰 것' : b === 'capacity' ? '소요가 없어 설계강도가 가장 작은 것' : '평가한 것 가운데 비가 가장 큰 것';
}

/** 「평가한 최대」(계약 9.5 — 지배가 미검토일 때 따로 한 줄. 머리 비로 쓰지 않는다) */
export function highestLine(r: CheckRow): string {
  const h = r.us?.highest_evaluated;
  if (!r.governs || r.us?.governs_basis !== 'not_evaluated') { return ''; }
  if (!h || typeof h !== 'object') { return '<div class="why2" data-highest="none">평가한 항목 없음</div>'; }
  const name = state.runs.find(x => x.key === r.run)?.rows.find(x => x.id === h.id && x.point === r.point)?.name ?? String(h.id);
  return `<div class="why2" data-highest="${esc(String(h.id))}">평가한 최대: ${esc(name)} ${typeof h.ratio === 'number' ? sigText(h.ratio, 3) : '—'} · ${esc(VERDICT_KO[String(h.verdict)]?.text ?? String(h.verdict ?? ''))}</div>`;
}

/** 같은 실행 · 같은 검토 지점의 항목(엔진 순서) */
function siblings(r: CheckRow): CheckRow[] { return state.runs.find(x => x.key === r.run)?.rows.filter(x => x.point === r.point) ?? [r]; }

/**
 * 입력 · 기본값 · 재료에서 온 값이면 그 칸의 검토 상태 출처(K2 — get_case_inputs.sources: 기본값 · 지정 · AI · 파일 · 하중 해석).
 * 엔진 인자 이름 → 검토 상태 키(caseFields.ENGINE_TO_CASE, 같은 이름이면 그대로). 퍼린 구간의 소요는 하중 해석이 정한다 — 그것은 엔진의 출처 그대로.
 */
function caseSourceOf(src: any): string {
  const k = String(src?.kind ?? '');
  if (!['user_input', 'engine_default', 'material'].includes(k) || !src?.key || !state.caseIn?.sources) { return ''; }
  const ck = ENGINE_TO_CASE[String(src.key)] ?? String(src.key);
  const cs = state.caseIn.sources[ck];
  return cs ? ` <span class="why2">검토 상태</span>${caseTag(cs, state.caseIn.inputs?.[ck] === null && cs === 'ai')}` : '';
}

/** 시트 1절의 표 — 이 항목 단계 입력의 출처별 */
function inputsTables(r: CheckRow): string {
  const steps: any[] = Array.isArray(r.si?.steps) ? r.si.steps : [];
  const left: string[] = [], right: string[] = [];
  const seen = new Set<string>();
  steps.forEach((st: any, k: number) => (Array.isArray(st?.inputs) ? st.inputs : []).forEach((q: any, m: number) => {
    const sk = String(q?.source?.kind ?? '');
    if (!sk || sk === 'step' || sk === 'specification') { return; }
    const id = `${q.symbol}|${sk}|${q?.source?.key ?? ''}|${q.value}`;
    if (seen.has(id)) { return; }
    seen.add(id);
    const tr = `<tr><td>${esc(String(q.symbol ?? ''))}${q?.source?.key && q.source.key !== q.symbol ? ` <span class="faint">${esc(String(q.source.key))}</span>` : ''}</td><td class="r">${qnum(q, `${r.src}steps.${k}.inputs.${m}.`)}</td><td>${sourceTag(q.source)}${caseSourceOf(q.source)}</td></tr>`;
    if (['section_property', 'material', 'buckling_analysis', 'check'].includes(sk)) { left.push(tr); } else { right.push(tr); }
  }));
  const loc = r.si?.location;
  if (loc && typeof loc === 'object') {
    const parts: string[] = [];
    if (loc.x && typeof loc.x.value === 'number') { parts.push(`x ${qnum(loc.x, `${r.src}location.x.`)}`); }
    const words = locWords(loc);
    right.unshift(`<tr data-loc="${esc(JSON.stringify({ support: loc.support ?? null, span: loc.span ?? null, region_support: loc.region_support ?? null, demand_basis: loc.demand_basis ?? null }))}"><td>검토 위치</td><td class="r">${parts.join(' ') || '—'}</td><td><span class="tag drv"${tip('엔진 · 호스트가 붙인 이 항목의 위치(location)')}>위치</span><span class="why2">${esc(words.join(' · '))}</span></td></tr>`);
  }
  // 랩(daca0ac): 단면 강도 Se · Vn 의 출처 — 퍼린 결과의 그 지점 랩 구간에서 지었는가, 짓지 않았으면 그 까닭(엔진은 휨 검토를 판정 없음으로)
  const ss = r.scope === 'lap' ? state.lap?.us?.section_source : null;
  if (ss && typeof ss === 'object') {
    const txt = ss.Se === null || ss.Se === undefined ? `짓지 않음 — ${plainText(ss.reason ?? '')}` : `${plainText(ss.from ?? '')}${ss.support !== null && ss.support !== undefined ? ` · 지점 ${String(ss.support)}` : ''}${Array.isArray(ss.regions) && ss.regions.length ? ` · ${ss.regions.join(', ')}` : ''}`;
    right.unshift(`<tr data-section-source><td>랩 단면 Se</td><td class="r">${typeof ss.Se === "number" ? `${sigText(si(ss.Se, "modulus") ?? ss.Se, 4)} mm³` : "—"}</td><td><span class="tag drv">출처</span><span class="why2">${esc(txt)}</span></td></tr>`);
  }
  if (r.combination) {
    const env = r.combination === 'envelope';
    right.unshift(`<tr data-combination="${esc(r.combination)}"><td>하중 조합</td><td class="r">${esc(COMBO_KO(r.combination))}</td><td><span class="tag drv">하중 해석</span>${env ? `<span class="why2"${tip('여러 조합 · 패턴의 포락선 값 — 하중 해석이 격자마다의 조합을 주지 않아 어느 조합인지 말할 수 없다')}>어느 조합인지 모름</span>` : ''}</td></tr>`);
  }
  // 퍼린: 고른 검토 지점 자신의 알림 글(그 지점 결과의 warnings · assumptions · scope_notes · not_checked — 보기 계약 4a)
  const pn = r.pointNotes;
  if (pn) {
    const lines: string[] = ([
      ...pn.warnings.map(t => ['경고', t]), ...pn.assumptions.map(t => ['가정', t]), ...pn.scope.map(t => ['범위', t]), ...pn.notChecked.map(t => ['검토 안 함', t]),
    ] as Array<[string, Note]>).map(([k, t]) => `<tr data-point-note="${esc(k)}"${t.code ? ` data-code="${esc(t.code)}"` : ''}><td>${esc(k)}</td><td colspan="2" class="pnote">${esc(t.text)}</td></tr>`);
    right.push(lines.length ? lines.join('') : `<tr data-point-note=""><td>이 지점의 알림</td><td colspan="2">${none('없음', '엔진이 이 검토 지점에 경고 · 가정 · 범위 글을 내지 않았다')}</td></tr>`);
  }
  const tbl = (title: string, rows: string[], empty: string) => `<table class="t"><tr><th colspan="3">${title}</th></tr>${rows.length ? rows.join('') : `<tr><td colspan="3">${none(empty)}</td></tr>`}</table>`;
  return `<div class="cols"><div>${tbl('단면과 좌굴', left, '이 항목은 단면 · 재료 · 좌굴 값을 쓰지 않았다')}</div><div>${tbl('설계 가정과 출처', right, '입력 · 기본값 · 하중 해석에서 온 값 없음')}</div></div>`;
}

/** 시트 2절 — 같은 지점 항목들의 소요(같은 기호 · 값은 한 줄) */
function demandsTable(r: CheckRow): string {
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const x of siblings(r)) {
    const d = x.si?.demand;
    if (!d || typeof d.value !== 'number') { continue; }
    const id = `${d.symbol}|${d.value}`;
    if (seen.has(id)) { continue; }
    seen.add(id);
    const loc = x.si?.location?.x;
    rows.push(`<tr><td>${esc(String(d.symbol ?? ''))} <span class="faint">${esc(x.name)}</span></td><td class="r">${qnum(d, `${x.src}demand.`)}</td><td>${esc(x.combination ? COMBO_KO(x.combination) : '—')}</td>`
      + `<td class="r">${loc && typeof loc.value === 'number' ? qnum(loc, `${x.src}location.x.`) : '—'}</td><td>${sourceTag(d.source)}</td></tr>`);
  }
  return `<table class="t"><thead><tr><th>항목</th><th class="r">소요</th><th>조합</th><th class="r">위치</th><th>출처</th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="5">${none('소요 없음', '엔진이 소요를 받지 않았다 — 강도만 냈다')}</td></tr>`}</tbody></table>`;
}

function miniM(r: CheckRow, w: number): string {
  if (!state.loads || r.xm === null) { return `<div class="dvbox dv ph"><div class="ph-box"><span>${state.loads ? '이 항목에 검토 위치 x 가 없다' : '하중 해석이 화면에 없다'}</span></div></div>`; }
  const m = memberSvg({ w, la: state.loads.si, rows: ['M'], regions: [], sel: null, loc: { x: r.xm, label: '' }, mini: true });
  return `<div class="dvbox dv" data-draw="member-mini">${m.svg}</div>`;
}

/** 시트의 앞 · 뒤(같은 갈래의 항목 — 엔진 순서) */
export function neighbours(key: string): { prev: CheckRow | null; next: CheckRow | null } {
  const { row } = rowOfKey(key);
  if (!row) { return { prev: null, next: null }; }
  const group = (x: CheckRow) => (x.scope === 'member' || x.scope === 'purlin' ? 'm' : x.scope);
  const list = allRows().filter(x => group(x) === group(row) && x.us);
  const i = list.findIndex(x => x.key === key);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}

export function sheetHtml(key: string, w = 900): string {
  const { run, row } = rowOfKey(key);
  if (!row || !run) {
    return `<article class="sheet" data-sheet-key="${esc(key)}"><div class="hd"><h2>계산 시트</h2><span class="sp"></span><span class="btn ghost" data-sheet-close>시트 닫기 ✕</span></div>`
      + `<p>${none('이 항목은 지금 결과에 없다', '결과가 지워졌거나(낡음) 다른 결과로 바뀌었다')}</p></article>`;
  }
  const r = row;
  const ups = (run: Run) => run.us ?? {};
  const res = state.full?.results ?? {};
  const atOf = (x: any) => (x?.at ? new Date(x.at).toTimeString().slice(0, 5) : '');
  const times = [res.load_analysis?.at ? `하중 해석 ${atOf(res.load_analysis)}` : '', res.buckling_analysis?.at ? `좌굴 해석 ${atOf(res.buckling_analysis)}` : '',
    r.scope === 'lap' ? (res.lap ? `랩 검토 ${atOf(res.lap)}` : '') : r.scope === 'connection' ? (res.connection ? `접합 검토 ${atOf(res.connection)}` : '') : (res.member_design ? `부재 검토 ${atOf(res.member_design)}` : '')].filter(Boolean);
  const sub = [sectionLabel(), `AISI S100-16 ${esc(String(r.us?.design_method ?? ups(run).design_method ?? ''))}`, ...times].filter(Boolean).join(' · ');
  const { prev, next } = neighbours(key);
  const sibs = siblings(r);
  const cards = sibs.map((x, i) => card(x, `3.${i + 1}`, key)).join('');
  const v = r.verdict;
  const big = typeof r.ratio === 'number' ? `<span class="num" style="font-size:20px">${ratio(r.ratio, v === 'fail', `${r.src}ratio`)}</span>` : '';
  return `<article class="sheet" data-sheet-key="${esc(key)}">`
    + `<div class="hd"><div><h2>${esc(r.where)} · ${esc(r.name)} — 계산 시트</h2><div class="dim" style="margin-top:3px">${esc(sub)}</div></div><span class="sp"></span>`
    + `<div style="text-align:right"><div>${verdictSpan(v)} ${big}</div><div class="dim"><span class="rv off"${tip('내가 확인했다는 표시. 사람만 켠다. 확인 기록은 R4 부터 남는다 — 지금은 꺼져 있다')}>미확인</span></div></div></div>`
    + `<div class="btns" style="margin-top:12px">${prev ? `<span class="btn ghost" data-sheet-go="${esc(prev.key)}"${tip('앞 항목 (Alt+←)')}>← ${esc(prev.where)} · ${esc(prev.name)}</span>` : ''}`
    + `${next ? `<span class="btn ghost" data-sheet-go="${esc(next.key)}"${tip('다음 항목 (Alt+→)')}>${esc(next.where)} · ${esc(next.name)} →</span>` : ''}<span style="flex:1"></span>`
    + `<span class="btn ghost" data-sheet-close${tip('Esc')}>시트 닫기 ✕</span></div>`
    + `<h3>1. 부재와 가정</h3>${inputsTables(r)}`
    + `<h3>2. 소요강도</h3><div class="cols"><div>${demandsTable(r)}${r.combination ? `<div class="note">${esc(COMBO_KO(r.combination))}${r.pointName ? ` · ${esc(POINT_KO(r.pointName))}` : ''}</div>` : ''}</div>${miniM(r, Math.max(360, Math.round(w * 0.45)))}</div>`
    + `<h3>3. 한계상태별 계산</h3><div class="sheet-cards">${cards}</div>`
    + (run.neTexts.length ? `<h3>엔진의 미검토 글</h3><ul class="notes">${run.neTexts.map(t => noteLi(t, esc)).join('')}</ul>` : '')
    + '</article>';
}

/** 정보 창 · 표에 쓰는 「소요 / 설계강도」 */
export function demandCapacity(r: CheckRow): string {
  const d = r.si?.demand, c = r.si?.capacity;
  if (!d || !c || typeof d.value !== 'number' || typeof c.value !== 'number') {
    return r.kind === 'ls' ? '<span class="faint">—</span>' : `<span class="faint">${r.kind === 'na' ? '해당 없음' : '평가 못 함'}</span>`;
  }
  return `${qnum(d, `${r.src}demand.`, { unit: false, sig: 3 })} / ${qnum(c, `${r.src}capacity.`, { sig: 3 })}`;
}

export const gaugeHtml = (r: number, ng: boolean): string => `<div class="gauge"><i style="width:${Math.min(100, r * 100).toFixed(1)}%;background:${bandVar(r, ng)}"></i></div><div class="gauge-k"><span>0</span><span>0.75</span><span>1.0</span></div>`;
