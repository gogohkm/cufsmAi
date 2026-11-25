/**
 * 점검(K3 — 검증 항목)과 문서 탭(계산서 · 좌굴 해석 보고서 · 검증표)의 보기 · 정보 창.
 *
 *  - 점검: 호스트 동작 `validate_design`(detail 'full' · SI — MCP 와 같은 목록, 호스트가 만든다: webview/js/review.js).
 *    항목은 호스트 그대로 — 고정 id(val.*) · 분류 · 이름 · 판정 · 값 · 기준 · 주석. 판정은 호스트의 셋(pass · warn · fail)을
 *    편집 상태의 검증 탭과 같은 말(통과 · 주의 · 실패)로 보인다. 화면은 다시 판정하지 않는다. 묶음은 분류(A … H) — 검증 탭과 같은 차례.
 *    낡음: 마지막 점검 뒤 호스트의 입력 판 · 남은 결과 · 무효 장부 · 모델이 바뀌었으면(store.valChanges) — 호스트는 점검을 쥐지 않는다.
 *  - 계산서 · 좌굴 해석 보고서: 호스트가 쓴 HTML 파일(다리 /api/report → 호스트 동작 generate_report). 자리 · 이름은 호스트가 정한다
 *    (열린 .csd 의 폴더 · 없으면 임시 폴더). 미리보기는 `<iframe sandbox="">`(스크립트 · 폼 · 팝업 · 같은 출처 모두 없음 — 바깥 문서에
 *    닿지 못한다)의 srcdoc = 호스트 파일의 글 그대로. srcdoc 문서는 이 화면의 CSP(default-src 'self' …)도 물려받아 바깥으로 요청하지 않는다.
 *  - 발행 · 검토 도장은 기록(R5 · R4)부터 — 꺼 두고 까닭을 적는다.
 */
import { esc, tip } from './dom';
import { hhmm, none } from './format';
import { state, valChanges, type ReportState, type ValItem } from './store';
import { checkPanel, docs, draftsOf, lastIssue } from './docs';
import { finder } from './notices';

/** 지금 제품에서 점검 규칙을 고치는 중(K3-6)인가 — 끝나면 false(그러면 화면에 아무 말도 하지 않는다) */
export const VAL_RULES_CHANGING = true;
const RULES_NOTE = '점검 규칙은 지금 제품에서 고치는 중이다(K3-6) — 항목 · 판정이 바뀔 수 있다';

/** 호스트의 판정 → 편집 상태 검증 탭의 말 */
export const VAL_KO: Record<string, string> = { pass: '통과', warn: '주의', fail: '실패' };
const VAL_CLS: Record<string, string> = { pass: 'ok', warn: 'warn', fail: 'ng' };
const VAL_DOT: Record<string, string> = { pass: 'ok', warn: 'warn', fail: 'ng' };
export const valLabel = (s: string): string => VAL_KO[s] ?? s;

export function valKey(it: ValItem, i: number): string { return `val#${it.id ?? `n${i}`}`; }
export function isValKey(key: string): boolean { return typeof key === 'string' && (key === 'val' || key.startsWith('val#') || key.startsWith('val:cat:')); }

/** 분류마다(처음 나온 차례) */
export function valGroups(): Array<{ cat: string; idx: number; items: Array<{ it: ValItem; key: string }>; counts: Record<string, number> }> {
  const out: Array<{ cat: string; idx: number; items: Array<{ it: ValItem; key: string }>; counts: Record<string, number> }> = [];
  (state.val?.items ?? []).forEach((it, i) => {
    let g = out.find(x => x.cat === it.category);
    if (!g) { g = { cat: it.category, idx: out.length, items: [], counts: {} }; out.push(g); }
    g.items.push({ it, key: valKey(it, i) });
    g.counts[it.status] = (g.counts[it.status] ?? 0) + 1;
  });
  return out;
}
export function valItemOf(key: string): ValItem | null {
  const items = state.val?.items ?? [];
  const i = items.findIndex((it, j) => valKey(it, j) === key);
  return i >= 0 ? items[i] : null;
}
const countsText = (c: Record<string, number>): string => ['fail', 'warn', 'pass'].filter(s => c[s]).map(s => `${VAL_KO[s]} ${c[s]}`).join(' · ') || '없음';
export const valCountsText = countsText;
const statusSpan = (s: string): string => `<span class="verdict ${VAL_CLS[s] ?? 'un'}" data-status="${esc(s)}">${esc(valLabel(s))}</span>`;
const dot = (s: string): string => `<span class="dot ${VAL_DOT[s] ?? 'un'}"></span>`;

function staleBanner(): string {
  const ch = valChanges();
  return ch.length ? `<div class="banner warn" data-val-stale="1"${tip('호스트의 장부(kind validation) — 마지막 점검 뒤 입력 · 모델이 바뀌었다')}>점검 뒤 바뀌었다 — ${esc(ch.join(' · '))}. 「점검 실행」으로 다시</div>` : '';
}
const runBtn = (label = '점검 실행'): string => `<span class="btn${state.valRunning ? ' off' : ''}" data-act="val-run"${tip('편집 화면의 「설계 검증 실행」과 같은 길 — 호스트가 지금 입력 · 모델 · 결과로 항목을 만든다(엔진을 부르지 않는다)')}>${esc(label)}</span>`;

/** 가운데 — 점검 목록(분류마다 표). sel = 고른 항목 키 */
export function valView(sel: string, asDocument = false): string {
  const v = state.val;
  const head = `<div class="pv-bar">${asDocument ? docChips('vtab') : '<b>점검</b>'}<span class="sp"></span>`
    + `${v ? `<span class="faint">${esc(countsText(v.counts))} · 판 ${esc(v.caseRev ?? '—')} · ${hhmm(v.at)} · ${(v.by === 'ai' ? 'AI 가 돌림' : v.by === 'page' ? '편집 화면 · 이 화면' : esc(v.by))}</span>` : ''}${runBtn(v ? '다시 점검' : '점검 실행')}</div>`;
  if (!v) {
    return `<div class="dv docv" data-docview="val">${head}${state.valErr ? `<div class="banner warn">점검을 읽지 못함 — ${esc(state.valErr)}</div>` : ''}`
      + staleBanner()
      + `<div class="ph-box" style="margin:40px auto">${none(valChanges().length ? '점검이 낡았다' : '점검 안 함', '「점검 실행」을 누르면 호스트가 지금 입력 · 모델 · 결과로 항목을 만든다(편집 화면의 「설계 검증 실행」과 같은 길)')}</div></div>`;
  }
  const groups = valGroups();
  const body = groups.map(g => `<section class="valg" data-cat="${esc(g.cat)}"><h4>${esc(g.cat)}<span class="sp"></span><span class="faint">${esc(countsText(g.counts))}</span></h4>`
    + `<table class="t valt"><thead><tr><th></th><th>검토 항목</th><th>판정</th><th>값</th><th>기준</th></tr></thead><tbody>`
    + g.items.map(({ it, key }) => `<tr class="vr${key === sel ? ' on' : ''}" data-k="${esc(key)}" data-id="${esc(it.id ?? '')}" data-status="${esc(it.status)}">`
      + `<td>${dot(it.status)}</td><td>${esc(it.item)}</td><td>${statusSpan(it.status)}</td><td class="num" data-value>${esc(it.value)}</td><td class="dim" data-criterion>${esc(it.criterion)}</td></tr>`
      + (it.note ? `<tr class="vn${key === sel ? ' on' : ''}" data-k="${esc(key)}"><td></td><td colspan="4" class="note-${VAL_CLS[it.status] ?? 'un'}" data-note>→ ${esc(it.note)}</td></tr>` : '')).join('')
    + '</tbody></table></section>').join('');
  return `<div class="dv docv" data-docview="val">${head}${staleBanner()}${VAL_RULES_CHANGING ? `<div class="banner" data-rules-changing="1">${esc(RULES_NOTE)}</div>` : ''}`
    + `<div class="valbody">${body}</div></div>`;
}

const kv = (k: string, v: string): string => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
const secH = (title: string, body: string, right = ''): string => `<div class="sec"><h4>${title}<span class="sp"></span>${right}</h4>${body}</div>`;

/** 정보 창 — 점검 전체 · 분류 · 항목 */
export function valInfo(key: string): string {
  const v = state.val;
  if (!v) {
    return `<div class="hd"><div class="k">결과 · 점검</div><div class="ttl">점검</div></div>`
      + secH('지금', `<p>${none('점검 안 함', '호스트의 validate_design 으로 만든다')}</p><div class="btns">${runBtn()}</div>`);
  }
  const it = key.startsWith('val#') ? valItemOf(key) : null;
  if (it) {
    return `<div class="hd"><div class="k">점검 · ${esc(it.category)}<span class="sp"></span>${statusSpan(it.status)}</div><div class="ttl">${esc(it.item)}</div><div class="dim num" data-val-id>${esc(it.id ?? '(id 없음)')}</div></div>`
      + secH('항목', `<dl class="kv">${kv('판정', statusSpan(it.status))}${kv('값', `<span class="num" data-value>${esc(it.value) || '—'}</span>`)}${kv('기준', `<span data-criterion>${esc(it.criterion) || '—'}</span>`)}`
        + `${kv('주석', it.note ? `<span data-note>${esc(it.note)}</span>` : '<span class="faint">없음</span>')}${it.source ? kv('엔진 항목', `<span class="num">${esc(JSON.stringify(it.source))}</span>`) : ''}</dl>`)
      + secH('출처', `<p class="dim">호스트가 만든 항목(validate_design · 편집 상태의 검증 탭과 같은 목록). 값 · 기준의 글은 호스트가 ${esc(v.units)} 단위로 쓴 것이다. 화면은 다시 판정하지 않는다.</p>`)
      + staleBanner();
  }
  const cat = key.startsWith('val:cat:') ? valGroups()[Number(key.slice(8))] : null;
  const list = (cat ? cat.items.map(x => x.it) : v.items).filter(x => x.status !== 'pass');
  return `<div class="hd"><div class="k">결과 · 점검<span class="sp"></span><span class="verdict ${v.counts.fail ? 'ng' : v.counts.warn ? 'warn' : 'ok'}">${esc(countsText(cat ? cat.counts : v.counts))}</span></div>`
    + `<div class="ttl">${esc(cat ? cat.cat : '점검')}</div><div class="dim" data-val-by="${esc(v.by)}">판 ${esc(v.caseRev ?? '—')} · ${hhmm(v.at)} · ${esc(v.units)} · ${(v.by === 'ai' ? 'AI 가 돌림' : v.by === 'page' ? '편집 화면 · 이 화면' : esc(v.by))}</div></div>`
    + staleBanner()
    + secH('수', `<table class="t"><tbody>${['pass', 'warn', 'fail'].map(s => `<tr data-count="${s}"><td>${dot(s)}${VAL_KO[s]}</td><td class="r num">${(cat ? cat.counts : v.counts)[s] ?? 0}</td></tr>`).join('')}`
      + `<tr><td>모두</td><td class="r num" data-count="total">${cat ? cat.items.length : v.counts.total ?? v.items.length}</td></tr></tbody></table>`)
    + secH(`통과가 아닌 것 ${list.length}`, list.length ? `<ul class="notes">${list.map(x => `<li>${esc(valLabel(x.status))} · ${esc(x.item)}${x.note ? ` — ${esc(x.note)}` : ''}</li>`).join('')}</ul>` : none('없음'))
    + `<div class="sec"><div class="btns">${runBtn('다시 점검')}</div></div>`;
}

// ── 문서 탭 ─────────────────────────────────────────────────────────
const KIND_OF: Record<string, 'design' | 'buckling'> = { rpt: 'design', brpt: 'buckling' };
const KIND_KO = { design: '계산서', buckling: '좌굴 해석 보고서' } as const;
export const reportKindOf = (key: string): 'design' | 'buckling' | null => KIND_OF[key] ?? null;

function docChips(on: string): string {
  return [['rpt', '계산서'], ['brpt', '좌굴 해석 보고서'], ['vtab', '검증표']].map(([k, t]) => `<span class="chip${k === on ? ' on' : ''}" data-doc="${k}">${t}</span>`).join('');
}
function curRev(): number | null { const f = state.full; return typeof f?.case?.rev === 'number' ? f.case.rev : typeof state.caseIn?.rev === 'number' ? state.caseIn.rev : null; }
/** 보고서가 지금과 맞나 — 만든 판과 지금 판(호스트) */
export function reportStale(r: ReportState | undefined): boolean { return !!r && r.caseRev !== null && curRev() !== null && r.caseRev !== curRev(); }
export function reportSummary(kind: 'design' | 'buckling'): { v: string; cls: string } {
  const r = state.reports[kind];
  if (!r || (!r.html && !r.reply)) { return { v: r?.error ? '만들지 못함' : '만들지 않음', cls: 'un' }; }
  return reportStale(r) ? { v: `낡음 · 판 ${r.caseRev}`, cls: 'warn' } : { v: `초안 · 판 ${r.caseRev ?? '—'}`, cls: '' };
}

const WHERE_KO: Record<string, string> = { case_folder: '열린 .csd 의 폴더', temp: '임시 폴더(열린 .csd 없음)', folder: '정해진 폴더', project: '프로젝트의 03_계산서(새 초안 — 덮어쓰지 않는다)' };

/** 가운데 — 보고서 미리보기 */
export function reportView(key: string): string {
  const kind = reportKindOf(key)!;
  const r = state.reports[kind];
  const sections: string[] = Array.isArray(r?.reply?.sections) ? r!.reply.sections.map(String) : [];
  const bar = `<div class="pv-bar">${docChips(key)}<span class="sp"></span>`
    + `${r?.reply?.pages ? `<span class="faint">PDF ${esc(r.reply.pages)}쪽</span>` : ''}`
    + `<span class="btn" data-act="rpt-make" data-kind="${kind}"${tip(`호스트가 ${KIND_KO[kind]}를 만들어 파일로 쓴다(generate_report) — 자리 · 이름은 호스트가 정한다`)}>${r?.html ? '다시 만들기' : `${KIND_KO[kind]} 만들기`}</span>`
    + `<span class="btn ghost" data-act="rpt-pdf" data-kind="${kind}"${tip('호스트의 길로 PDF 를 쓴다(보이지 않는 Edge 인쇄) — 같은 폴더에')}>PDF 저장</span></div>`;
  const err = r?.error ? `<div class="banner warn" data-report-error>${esc(r.error)}</div>` : '';
  const stale = reportStale(r) ? `<div class="banner warn" data-report-stale="1">이 보고서를 만든 뒤 검토 입력이 바뀌었다(판 ${esc(r!.caseRev)} → ${esc(curRev())}) — 다시 만들면 지금 것으로</div>` : '';
  const thumbs = sections.length ? `<div class="thumbs">${sections.slice(0, 14).map((t, i) => `<div class="thumb" data-section="${i}"><div class="pg-s"><i class="h"></i><i class="s"></i><i></i></div>${esc(`${i + 1} ${t}`)}</div>`).join('')}</div>` : '';
  const frame = r?.html
    ? `<iframe class="rframe" sandbox="" referrerpolicy="no-referrer" title="${esc(KIND_KO[kind])} 미리보기" data-report="${kind}" data-sha256="${esc(r.sha256 ?? '')}" srcdoc="${esc(r.html)}"></iframe>`
    : `<div class="ph-box" style="margin:40px auto">${none(`${KIND_KO[kind]} 없음`, kind === 'design' ? '설계 · 하중 결과가 있을 때 호스트가 만든다 — 「만들기」' : '좌굴 해석 결과가 있을 때 호스트가 만든다(화면 없이 만들면 서명곡선 SVG 만 — 보고서 안에 그렇다고 적힌다)')}</div>`;
  return `<div class="dv docv" data-docview="report" data-kind="${kind}">${bar}${err}${stale}${thumbs}${frame}</div>`;
}

/** 정보 창 — 보고서 */
export function reportInfo(key: string): string {
  const kind = reportKindOf(key)!;
  const r = state.reports[kind];
  const reply = r?.reply ?? {};
  const files = reply.files ?? {};
  const res = state.full?.results ?? {};
  const basis = [['buckling_analysis', '좌굴'], ['load_analysis', '하중'], ['member_design', '검토'], ['lap', '랩'], ['connection', '접합부']]
    .filter(([k]) => res[k]?.at).map(([k, t]) => `${t} ${hhmm(res[k].at)}`).join(' · ') || '결과 없음';
  // 호스트의 보고서 답(generate_report)의 notices 는 옛 글(엔진의 US 문자열 — 부호 없음)이다. 같은 결과 나무 안의 알림을 글로 찾아 그 알림으로
  // 그린다(notices.js 의 textMap — 한국어 · SI, 보기 계약 4d). 찾지 못한 글은 notices.js 가 그 안의 US 상수만 바꾼다(D1 — u60b 가 찾은 「Vu = 2.001 kips」)
  const tree = { runs: state.runs.map(x => x.us), lap: state.lap?.us ?? null, conn: state.conn?.us ?? null, loads: state.loads?.us ?? null };
  const find = finder(tree);
  const notices: string[] = Array.isArray(reply.notices) ? reply.notices.map((t: unknown) => find(String(t)).text) : [];
  const fail: string[] = Array.isArray(reply.checks?.fail) ? reply.checks.fail : [];
  const ne: string[] = Array.isArray(reply.checks?.not_evaluated) ? reply.checks.not_evaluated : [];
  // R5-3: 프로젝트의 대상이면 발행 전 점검(호스트의 documents check)과 사람의 발행 길 — 아니면 이 화면이 만든 보고서만
  const inProj = docs.loaded && kind === 'design';
  const li = lastIssue();
  const head = inProj
    ? `<div class="hd"><div class="k">${KIND_KO[kind]} · ${li ? `마지막 발행 R${esc(li.revision)}` : '발행 차수 없음'}<span class="sp"></span><span class="verdict ${docs.check?.blocked === false ? 'ok' : 'warn'}" data-issue-verdict>${docs.check?.blocked === false ? '발행 가능' : '발행 불가'}</span></div>`
      + `<div class="ttl">${KIND_KO[kind]}${state.file.name ? ` — ${esc(state.file.name)}` : ''}</div></div>`
    : `<div class="hd"><div class="k">${KIND_KO[kind]} · 발행 차수 없음<span class="sp"></span><span class="verdict warn"${tip('발행은 프로젝트의 검토 대상에서만 — 사람만 한다')}>발행 불가</span></div>`
    + `<div class="ttl">${KIND_KO[kind]}${state.file.name ? ` — ${esc(state.file.name)}` : ''}</div></div>`;
  const dr = docs.loaded ? draftsOf(kind === 'design' ? 'calc' : 'buckling')[0] : undefined;
  const status = dr
    ? `<span class="tag def">초안</span> <span class="why" data-draft-state="${esc(dr.state)}">${esc(dr.item)} · ${hhmm(dr.at)} 만듦${dr.state === 'stale' ? ' · <b class="warn">낡음</b>' : ' · 지금과 일치'}</span>`
    : r && (r.html || r.reply)
    ? `<span class="tag def">초안</span> <span class="why">${hhmm(r.at)} 만듦 · 판 ${esc(r.caseRev ?? '—')}${reportStale(r) ? ' · <b class="warn">낡음</b>' : ''}</span>`
    : `<span class="faint">${r?.error ? `만들지 못함 — ${esc(r.error)}` : '만들지 않음'}</span>`;
  const fileRow = (label: string, f: unknown, extra = '') => (typeof f === 'string' ? `<tr data-file="${esc(label)}"><td>${esc(label)}</td><td class="path num">${esc(f)}${extra}</td></tr>` : '');
  if (Array.isArray(reply.files)) { const fl = reply.files as string[]; (files as any).html = fl.find(x => /\.html?$/i.test(x)); (files as any).pdf = fl.find(x => /\.pdf$/i.test(x)); }
  return head
    + secH('', `<dl class="kv">${kv('상태', status)}${kv('대상', esc(state.file.name ?? '파일 없음'))}${kv('근거', esc(basis))}${kv('기준', `AISI S100-16 · ${esc(reply.units ?? 'SI')}`)}`
      + `${reply.verdict ? kv('판정', `<span class="verdict ${reply.verdict === 'PASS' ? 'ok' : reply.verdict === 'FAIL' ? 'ng' : 'un'}" data-report-verdict>${esc(reply.verdict === 'PASS' ? 'OK' : reply.verdict === 'FAIL' ? 'NG' : '미검토')}</span>`) : ''}</dl>`)
    + secH('쓴 곳', reply.folder || files.html || files.pdf
      ? `<p class="dim" data-report-folder="${esc(reply.folder ?? '')}">${esc(WHERE_KO[reply.folder] ?? String(reply.folder ?? ''))} — 자리 · 이름은 호스트가 정한다(화면은 경로를 주지 않는다). 이 프로그램이 쓴 파일만 덮어쓴다</p>`
        + `<table class="t"><tbody>${fileRow('HTML', files.html)}${fileRow('PDF', files.pdf, reply.pages ? ` · ${esc(reply.pages)}쪽` : '')}</tbody></table>${reply.pdf_note ? `<p class="warn" data-pdf-note="${esc(String(reply.pdf_note_code ?? ''))}">${esc(reply.pdf_note_ko ?? reply.pdf_note)}</p>` : ''}${reply.folder_note ? `<p class="dim" data-folder-note>${esc(reply.folder_note_ko ?? reply.folder_note)}</p>` : ''}`
      : none('아직 쓰지 않음'))
    + (notices.length ? secH(`알림 ${notices.length}`, `<ul class="notes">${notices.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`) : '')
    + (fail.length || ne.length ? secH('통과가 아닌 검토', `<table class="t"><tbody>${fail.length ? `<tr><td><span class="dot ng"></span>NG</td><td class="num">${esc(fail.join(', '))}</td></tr>` : ''}${ne.length ? `<tr><td><span class="dot un"></span>미검토</td><td class="num">${esc(ne.join(', '))}</td></tr>` : ''}</tbody></table>`) : '')
    + (inProj ? checkPanel()
      : `<div class="sec publish"><span class="btn primary off" data-publish${tip('발행은 프로젝트의 검토 대상에서만 — 기록이 있어야 한다(사람만)')}>R0 발행</span><span class="faint">프로젝트 밖 — 발행 없음</span></div>`);
}

/** 문서 탭의 검증표 — 점검 목록을 문서 꼴로(같은 항목) */
export function vtabView(sel: string): string { return valView(sel, true); }
