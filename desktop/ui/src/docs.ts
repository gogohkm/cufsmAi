/**
 * R5-3 — 문서 · 발행(기록 설계 §1.3 · §5.2 · §10.9, 보기 계약 §4i, 템플릿 08).
 *  - 문서 탭은 호스트의 `documents list`(초안: 일치 · 낡음과 까닭, 발행: R<n> · 날짜 · 발행한 사람 · 그대로 / 고쳐짐 / 없어짐과 다른 파일)를 그린다.
 *  - 발행 전 점검은 `documents check`(막는 것 · 경고 · 통과 — 글은 code 로 가른 호스트의 text_ko).
 *  - 발행은 사람의 길로만: `/api/person/issue/preview`(호스트 issuePreview — 일회용 숫자 2 분) → 미리보기 창 → 「R<n> 발행」 →
 *    `/api/person/issue`(호스트 issue — 인쇄를 기다린다). MCP 중계로는 보내지 않는다. 막는 것이 있으면 단추가 꺼진다.
 *  - 「초안으로 내보내기」 는 막는 것과 무관하게 사람의 저장 대화상자로(`/api/person/export`).
 *  - 초안 · 발행본의 HTML 은 `/api/person/doc-file`(읽기만)로 받아 sandbox 틀(스크립트 · 같은 출처 없음)에 그린다.
 * 화면은 막는 것을 스스로 판단하지 않는다 — 호스트가 준 목록 그대로.
 */
import { api, mcp } from './bridge';
import { esc, tip } from './dom';
import { hhmm, none } from './format';
import { hostText, resultKindKo } from './notices';
import { person, project, rec, roText } from './records';
import { rv } from './reviews';

export interface DocDraft { file_state?: 'same' | 'edited' | 'missing'; item: string; kind: string; at: string; at_local?: string; by: any; files: string[]; not_checked: number; state: 'current' | 'stale'; stale_because?: string[]; stale_because_ko?: string[] }
export interface DocIssue { item: string; revision: number; at: string; at_local?: string; date?: string; issued_by: string; from: string; folder: string; state: 'same' | 'edited' | 'missing'; state_ko: string;
  files?: Array<{ path: string; state: string }>; added?: string[] }
export interface IssueCheck { revision: string; folder: string; blocked: boolean; blockers: Note[]; warnings: Note[]; passed: string[]; passed_labels?: Array<{ code: string; text_ko?: string }>;
  draft: any; files: string[]; bundle?: Array<{ path: string; role: string }>; fingerprint: string }
interface Note { code: string; count?: number; detail?: string; detail_ko?: string; text?: string; text_ko?: string }
export interface Preview extends IssueCheck { label: string; caseName: string; nonce: string; expiresAt: string; stamped_html?: string | null; openedAt: number; spent?: boolean }

export const docs: {
  drafts: DocDraft[]; issues: DocIssue[]; failed: any[]; check: IssueCheck | null; loaded: boolean; err?: string; checkErr?: string;
  view: Map<string, { html?: string | null; name?: string; files?: string[]; err?: string; loading?: boolean }>;
  pv: Preview | null; pvErr?: { code: string; text: string } | null; issuing: boolean; pvLoading: boolean;
} = { drafts: [], issues: [], failed: [], check: null, loaded: false, view: new Map(), pv: null, pvErr: null, issuing: false, pvLoading: false };

let rerender: () => void = () => undefined;
let notify: (text: string, level?: 'info' | 'warning') => void = () => undefined;
let progress: (p: { id: string; title?: string; message?: string; done?: boolean }) => void = () => undefined;
let goDamage: () => void = () => undefined;
export function initDocs(o: { render: () => void; toast: typeof notify; progress: typeof progress; goDamage?: () => void }): void {
  rerender = o.render; notify = o.toast; progress = o.progress; if (o.goDamage) { goDamage = o.goDamage; }
}

let docsSeq = 0;
/** 프로젝트의 대상일 때만 — 목록과 점검 */
export async function loadDocs(): Promise<void> {
  if (!project()?.inProject || !project()?.case) { docs.drafts = []; docs.issues = []; docs.failed = []; docs.check = null; docs.loaded = false; return; }
  const n = ++docsSeq;
  const [ls, ck] = await Promise.all([mcp<any>('documents', { op: 'list' }), mcp<any>('documents', { op: 'check' })]);
  if (n !== docsSeq) { return; }  // 뒤에 보낸 읽기가 있다 — 그 답만 넣는다
  if (ls && !ls.error) {
    docs.drafts = Array.isArray(ls.drafts) ? ls.drafts : []; docs.issues = Array.isArray(ls.issues) ? ls.issues : []; docs.failed = Array.isArray(ls.failed) ? ls.failed : []; docs.err = undefined;
  } else { docs.err = String(ls?.error ?? '문서 목록을 읽지 못함'); }
  if (ck && !ck.error) { docs.check = ck; docs.checkErr = undefined; } else { docs.check = null; docs.checkErr = String(ck?.error ?? '점검을 읽지 못함'); }
  docs.loaded = true;
  // 고친 · 새로 생긴 문서는 다시 받는다(받아 둔 그림이 지금 것과 다를 수 있다)
  docs.view.clear();
}

/** 지금 대상의 마지막 발행(시작 화면의 「발행 R0」) */
export const lastIssue = (): DocIssue | null => docs.issues[0] ?? null;
/** 다음 차수(점검의 revision — 'R0' …) */
export const nextLabel = (): string => docs.check?.revision ?? (docs.issues.length ? `R${docs.issues[0].revision + 1}` : 'R0');

// ── 말 ──────────────────────────────────────────────────────────────
/** 막는 것의 짧은 이름(템플릿 08 의 줄 — code 로 가른다. 호스트의 문장은 풍선에) */
const SHORT: Record<string, string> = {
  'no-design-result': '부재 설계 결과', 'stale-results': '낡은 결과', 'not-evaluated': '미검토', ng: '불합격', 'open-questions': '열린 판단 요청',
  'incomplete-reviews': '검토 기록', 'provisional-assumptions': '임시 가정', 'unsaved-changes': '저장 안 한 변경', 'no-draft': '계산서 초안', 'stale-draft': '낡은 초안',
  'damaged-records': '기록 손상', 'read-only': '읽기 전용', 'unknown-issue-folder': '모르는 발행 폴더',
  'report-notices': '결과의 경고', 'changed-sources': '원자료', 'edited-previous-issue': '지난 발행본', 'same-as-previous-issue': '지난 발행과 같음',
};
/** 초안이 낡은 까닭 — 호스트의 stale_because_ko(없으면 표지로) */
const staleList = (d: DocDraft): string[] => (Array.isArray(d.stale_because_ko) && d.stale_because_ko.length ? d.stale_because_ko : (d.stale_because ?? []).map(staleWhy));
function staleWhy(s: string): string {
  const m = /^results \((.+)\)$/.exec(s);
  if (m) { return `결과(${resultKindKo(m[1])})`; }
  return ({ 'inputs or model': '입력 · 모델', engine: '엔진', 'assumptions, work items or reviews': '가정 · 업무 · 확인' } as Record<string, string>)[s] ?? s;
}
/** 막는 것 · 경고의 오른쪽 값 — 개수 · id(호스트의 detail 중 id · 결과 종류 · 숫자만; 영어 문장은 보이지 않는다) */
function noteValue(n: Note): string {
  if (typeof n.detail_ko === 'string' && n.detail_ko) { return n.detail_ko; }
  const d = typeof n.detail === 'string' ? n.detail : '';
  switch (n.code) {
    case 'stale-results': return d ? d.split(', ').map(resultKindKo).join(' · ') : String(n.count ?? '');
    case 'open-questions': case 'provisional-assumptions': case 'changed-sources': return d ? d.split(', ').join(' · ') : String(n.count ?? '');
    case 'incomplete-reviews': { const m = /(\d+)\/(\d+)/.exec(d); const a = /again (\d+)/.exec(d); return m ? `${m[1]}/${m[2]}${a && a[1] !== '0' ? ` · 다시 ${a[1]}` : ''}` : String(n.count ?? ''); }
    case 'read-only': return roText(d);
    case 'edited-previous-issue': return d ? d.split(', ').map(x => x.replace(/: edited$/, ' 고쳐짐').replace(/: missing$/, ' 없어짐')).join(' · ') : String(n.count ?? '');
    case 'same-as-previous-issue': return d;
    case 'stale-draft': return d.split(' ')[0] ?? '';
    default: return typeof n.count === 'number' ? String(n.count) : '';
  }
}
const noteText = (n: Note): string => n.text_ko || hostText(`host.issue.${n.code}`) || SHORT[n.code] || n.code;
function noteRows(list: Note[], dot: string, attr: string, inPreview = false): string {
  // 템플릿 08: 짧은 이름 + 값, 호스트의 문장(text_ko)은 풍선 — 이름이 없는 code 는 문장 그대로.
  // V9b-04 · D1: 「기록 손상」 은 그것을 푸는 자리로 이끈다(문서 탭 「기록 손상」 — 격리 · 받아들이기). 미리보기에서는 미리보기를 닫고 간다
  const go = (n: Note): string => (n.code !== 'damaged-records' ? ''
    : inPreview ? ` <a class="lnk" data-pv="damage">손상 보기 →</a>` : ` <a class="lnk" data-ref-go="doc|dmg" data-dmg-go>손상 보기 →</a>`);
  return list.map(n => `<li ${attr}="${esc(n.code)}"${tip(noteText(n))}><span class="dot ${dot}"></span> <span>${esc(SHORT[n.code] ?? noteText(n))}</span>${go(n)}<span class="sp"></span><span class="num faint">${esc(noteValue(n))}</span></li>`).join('');
}
/** 통과한 점검의 이름 — 호스트의 passed_labels(text_ko) */
function passedNames(c: IssueCheck): string[] {
  const byCode = new Map((c.passed_labels ?? []).map(l => [l.code, l.text_ko]));
  return c.passed.map(p => byCode.get(p) || hostText(`host.issue.pass.${p}`) || SHORT[p] || p);
}
/** 묶음의 역할(템플릿 08 「발행본에 묶이는 것」) */
const ROLE_KO: Record<string, string> = { html: '계산서 HTML', pdf: '계산서 PDF', 'buckling-html': '좌굴 해석 보고서 HTML', 'buckling-pdf': '좌굴 해석 보고서 PDF',
  'validation-html': '검증표 HTML', 'validation-pdf': '검증표 PDF', 'case-file': '.csd 사본', manifest: '목록 파일' };
function bundleRows(c: IssueCheck): string {
  const b = Array.isArray(c.bundle) && c.bundle.length ? c.bundle : c.files.map(path => ({ path, role: '' }));
  return b.map(x => `<li class="num" data-role="${esc(x.role)}"${tip(x.path)}>${esc(ROLE_KO[x.role] ?? x.role)} <span class="faint">${esc(base(x.path))}</span></li>`).join('');
}

// ── 문서 탭(트리) ─────────────────────────────────────────────────────
export function draftLabel(d: DocDraft): string { return `${d.item} · ${hhmm(d.at)}`; }
const whenOf = (x: { at: string; at_local?: string }): string => x.at_local || `${localDate(x.at)} ${hhmm(x.at)}`;
/** 이 PC 의 날짜(YYYY-MM-DD) — 기록의 때는 UTC */
export function localDate(at: string | number | Date = new Date()): string {
  const d = new Date(at); if (Number.isNaN(d.getTime())) { return String(at ?? '').slice(0, 10); }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function issueLabel(x: DocIssue): string { return `R${x.revision} · ${x.date || localDate(x.at)} · ${x.issued_by}`; }
export const issueCls = (x: DocIssue): string => (x.state === 'same' ? 'ok' : 'warn');
export const draftsOf = (kind: 'calc' | 'buckling'): DocDraft[] => docs.drafts.filter(d => d.kind === kind);

// ── 가운데 ───────────────────────────────────────────────────────────
/** 초안 · 발행본의 HTML 을 받는다(읽기만) — 받으면 다시 그린다 */
function fetchDoc(item: string): void {
  const v = docs.view.get(item);
  if (v && (v.loading || v.html !== undefined || v.err)) { return; }
  docs.view.set(item, { loading: true });
  void api<any>('GET', `/api/person/doc-file?item=${encodeURIComponent(item)}`).then(r => {
    docs.view.set(item, r.success ? { html: r.data?.html ?? null, name: r.data?.name, files: Array.isArray(r.data?.files) ? r.data.files.map(String) : [] } : { err: String(r.error ?? '읽지 못함') });
    rerender();
  });
}
const base = (f: string): string => String(f).split('/').pop() ?? String(f);
const frame = (html: string, item: string, title: string): string =>
  `<iframe class="rframe" sandbox="" referrerpolicy="no-referrer" title="${esc(title)}" data-doc-frame="${esc(item)}" srcdoc="${esc(html)}"></iframe>`;

export function docView(key: string): string {
  const isIssue = key.startsWith('iss:');
  const item = key.slice(4);
  const d = isIssue ? null : docs.drafts.find(x => x.item === item);
  const x = isIssue ? docs.issues.find(i => i.item === item) : null;
  if (!d && !x) { return `<div class="dv docv">${none('그 문서가 없다', docs.err ?? '목록에 없다 — 다시 읽기')}</div>`; }
  if (!d || !d.file_state || d.file_state === 'same') { fetchDoc(item); }
  const v = docs.view.get(item);
  const banner = x
    ? `<div class="banner ${x.state === 'same' ? '' : 'warn'}" data-issue-state="${esc(x.state)}">발행본 ${esc(`R${x.revision}`)} — 읽기 전용 · 해시 대조: <b>${esc(x.state_ko)}</b>${x.state !== 'same' && x.files?.length ? ` — ${x.files.map(f => `${esc(f.path.split('/').pop() ?? f.path)} ${f.state === 'missing' ? '없어짐' : '고쳐짐'}`).join(' · ')}` : ''}${x.added?.length ? ` · 더해진 파일 ${esc(x.added.join(', '))}` : ''}</div>`
    : `<div class="banner ${d!.state === 'current' ? '' : 'warn'}" data-draft-state="${esc(d!.state)}">초안 ${esc(d!.item)} — ${d!.state === 'current' ? '지금과 일치' : `낡음 · ${esc(staleList(d!).join(' · '))}`}${d!.not_checked ? ` · 확인 안 함 ${esc(d!.not_checked)}` : ''}</div>`;
  // S2: 디스크의 초안 파일이 그 초안 줄의 해시와 다르면(호스트의 file_state) 그리지 않는다 — 「고쳐짐」 · 「없어짐」
  const draftBad = !!d && !!d.file_state && d.file_state !== 'same';
  const body = draftBad ? `<div class="banner warn" data-draft-file="${esc(d!.file_state)}">디스크의 초안 파일이 ${d!.file_state === 'missing' ? '없어졌다' : '고쳐졌다'} — 기록된 해시와 다르다. 이 화면은 그 파일을 그리지 않는다(발행은 기록된 사본에서 다시 그린다)</div>`
    : v?.html ? frame(v.html, item, isIssue ? '발행본' : '초안')
    : v?.err ? `<div class="ph-box" style="margin:40px auto">${none('읽지 못함', v.err)}</div>`
      : v?.html === null ? `<div class="ph-box" style="margin:40px auto">${none('HTML 없음', 'PDF 만 있다 — 정보 창의 「PDF 열기」')}</div>`
        : `<div class="ph-box" style="margin:40px auto">${none('읽는 중')}</div>`;
  return `<div class="dv docv" data-docview="${isIssue ? 'issue' : 'draft'}" data-item="${esc(item)}">${banner}${body}</div>`;
}

// ── 정보 창 ──────────────────────────────────────────────────────────
/** 발행 전 점검(템플릿 08 의 오른쪽) — 계산서 · 발행 줄의 정보 창 아래쪽 */
export function checkPanel(): string {
  const c = docs.check;
  if (!c) { return `<div class="sec">${none('발행 전 점검을 읽지 못함', docs.checkErr ?? '')}</div>`; }
  const label = c.revision || nextLabel();
  const pass = c.passed.length;
  return `<div class="sec" data-issue-check data-blocked="${c.blocked ? 1 : 0}"><h4>발행을 막는 것 ${c.blockers.length}<span class="sp"></span><span class="faint">통과 ${pass}</span></h4>`
    + (c.blockers.length ? `<ul class="issrows">${noteRows(c.blockers, 'ng', 'data-blocker')}</ul>` : `<p class="dim">없음 — 발행할 수 있다(미리보기에서 다시 점검한다)</p>`)
    + (pass ? `<details class="faint"><summary>통과 ${pass}</summary><ul class="notes">${passedNames(c).map((t, i) => `<li data-passed="${esc(c.passed[i])}">${esc(t)}</li>`).join('')}</ul></details>` : '') + `</div>`
    + (c.warnings.length ? `<div class="sec"><h4>경고 ${c.warnings.length}</h4><ul class="issrows">${noteRows(c.warnings, 'warn', 'data-warning')}</ul></div>` : '')
    + `<div class="sec"><h4>발행본에 묶이는 것<span class="sp"></span><span class="faint num" data-issue-folder>${esc(c.folder)}/</span></h4>`
    + (c.files.length ? `<ul class="notes" data-bundle>${bundleRows(c)}</ul>` : none('초안이 없다'))
    + `<p class="faint">가정 목록 · 검토 기록 요약은 계산서 안의 절 — 목록 파일(manifest.json)이 파일마다 해시 · 역할</p></div>`
    + `<div class="sec publish"><span class="btn${c.blocked ? '' : ' primary'}" data-issue-open${tip(`발행 미리보기를 연다(사람의 길 — 일회용 숫자 2 분). ${c.blocked ? '막는 것이 있으면 미리보기의 발행 단추가 꺼진다' : '미리보기에서 「' + label + ' 발행」'}`)}>${esc(label)} 발행</span>`
    + `${c.blocked ? `<span class="faint" data-blocked-count>막는 것 ${c.blockers.length}</span>` : ''}<span class="sp"></span>`
    + `<a class="lnk" data-doc-export${tip('발행 차수 없이 내보낸다 — 초안 그대로(도장 「초안 · 확인 안 함」). 막는 것과 무관하게, 사람의 저장 대화상자로')}>초안으로 내보내기</a></div>`;
}

/** 초안 줄의 정보 창 */
export function draftInfo(key: string): string {
  const d = docs.drafts.find(x => x.item === key.slice(4));
  if (!d) { return `<div class="hd"><div class="ttl">초안</div></div>${none('그 초안이 없다')}`; }
  return `<div class="hd"><div class="k">${d.kind === 'calc' ? '계산서' : '좌굴 해석 보고서'} · 초안<span class="sp"></span><span class="verdict ${d.state === 'current' ? 'ok' : 'warn'}" data-draft-state="${esc(d.state)}">${d.state === 'current' ? '일치' : '낡음'}</span></div>`
    + `<div class="ttl">${esc(d.item)}</div><div class="dim">${esc(whenOf(d))} · ${esc(BY[d.by?.kind] ?? d.by?.kind ?? '')}${d.not_checked ? ` · 확인 안 함 ${esc(d.not_checked)}` : ''}</div></div>`
    + (d.state === 'stale' ? `<div class="sec"><h4>낡은 까닭</h4><ul class="notes" data-stale-because>${staleList(d).map((s, i) => `<li data-why="${esc((d.stale_because ?? [])[i] ?? '')}">${esc(s)}</li>`).join('')}</ul></div>` : '')
    + `<div class="sec"><h4>파일</h4><ul class="notes">${d.files.map(f => `<li class="num">${esc(f)}</li>`).join('')}</ul>`
    + `${d.files.some(f => /\.pdf$/i.test(f)) ? `<a class="lnk" data-doc-open="${esc(d.item)}">PDF 열기</a> · ` : ''}<a class="lnk" data-doc-export="${esc(d.item)}">초안으로 내보내기</a></div>`;
}
const BY: Record<string, string> = { person: '사람', ai: 'AI', program: '프로그램', external: '밖에서' };

/** 발행 줄의 정보 창 — 읽기 전용, 해시 상태 */
export function issueInfo(key: string): string {
  const x = docs.issues.find(i => i.item === key.slice(4));
  if (!x) { return `<div class="hd"><div class="ttl">발행</div></div>${none('그 발행이 없다')}`; }
  return `<div class="hd"><div class="k">발행본 · 읽기 전용<span class="sp"></span><span class="verdict ${issueCls(x)}" data-issue-state="${esc(x.state)}">${esc(x.state_ko)}</span></div>`
    + `<div class="ttl">R${esc(x.revision)}</div><div class="dim">${esc(whenOf(x))} · 발행한 사람 ${esc(x.issued_by)} · 초안 ${esc(x.from)}</div></div>`
    + `<div class="sec"><h4>폴더</h4><p class="num">${esc(x.folder)}/</p></div>`
    + issueFiles(x)
    + `<div class="sec"><a class="lnk" data-doc-open="${esc(x.item)}">PDF 열기</a><span class="faint"> — OS 의 기본 앱으로(이 프로그램은 발행본을 고치지 않는다)</span></div>`;
}

/**
 * 발행본의 파일 모두(묶음 여덟 — 계산서 · 좌굴 해석 보고서 · 검증표의 html · pdf, .csd 사본, 목록 파일)와 그 대조(호스트의 해시 — 그대로 · 고쳐짐 · 없어짐 · 더해짐).
 * 파일 이름은 폴더에서(doc-file), 상태는 documents list 가 다르다고 한 것만 — 나머지는 그대로
 */
function issueFiles(x: DocIssue): string {
  fetchDoc(x.item);
  const v = docs.view.get(x.item);
  const diff = new Map((x.files ?? []).map(f => [base(f.path), f.state]));
  const names = [...new Set([...(v?.files ?? []), ...diff.keys()])];
  const row = (n: string, st: string) => `<li class="num" data-file-state="${esc(st)}"><span class="dot ${st === 'same' ? 'ok' : 'warn'}"></span> ${esc(n)} — ${st === 'same' ? '그대로' : st === 'missing' ? '없어짐' : st === 'added' ? '더해짐' : '고쳐짐'}</li>`;
  const rows = names.map(n => row(n, diff.get(n) ?? 'same')).join('') + (x.added ?? []).map(a => row(base(a), 'added')).join('');
  return `<div class="sec"><h4>파일 ${names.length}<span class="sp"></span><span class="faint">${x.state === 'same' ? '해시가 발행 때와 같다' : '다른 파일이 있다'}</span></h4><ul class="notes" data-issue-files>${rows || '<li class="faint">읽는 중</li>'}</ul></div>`;
}

// ── 미리보기 창(사람의 길) ──────────────────────────────────────────
let pvTimer: number | null = null;
function host(): HTMLElement {
  let h = document.getElementById('issue-host');
  if (!h) { h = document.createElement('div'); h.id = 'issue-host'; document.body.appendChild(h); h.addEventListener('click', onPvClick); }
  return h;
}
export async function openPreview(): Promise<void> {
  docs.pvErr = null; docs.pv = null; docs.pvLoading = true; renderPreview();
  const r = await person('issue/preview');
  docs.pvLoading = false;
  if (!r.ok) { docs.pv = null; docs.pvErr = { code: 'preview', text: `미리보기를 열지 못했다 — ${r.error ?? ''}` }; renderPreview(); return; }
  docs.pv = { ...r.data, openedAt: Date.now() } as Preview;
  if (pvTimer !== null) { clearTimeout(pvTimer); }
  const ms = Math.max(0, Date.parse(docs.pv.expiresAt) - Date.now());
  pvTimer = window.setTimeout(() => { pvTimer = null; renderPreview(); }, ms + 50);
  renderPreview();
}
export const pvExpired = (): boolean => !!docs.pv && Date.parse(docs.pv.expiresAt) <= Date.now();
export function closePreview(): void {
  docs.pv = null; docs.pvErr = null;
  if (pvTimer !== null) { clearTimeout(pvTimer); pvTimer = null; }
  const h = document.getElementById('issue-host'); if (h) { h.innerHTML = ''; h.classList.remove('open'); }
}
function renderPreview(): void {
  const h = host();
  const p = docs.pv;
  if (!p && !docs.pvErr && !docs.pvLoading) { h.innerHTML = ''; h.classList.remove('open'); return; }
  h.classList.add('open');
  const err = docs.pvErr ? `<div class="banner warn" data-issue-refused="${esc(docs.pvErr.code)}">${esc(docs.pvErr.text)}</div>` : '';
  if (!p) { h.innerHTML = `<div class="dialog issue-pv" role="dialog" aria-modal="true" data-pv-loading="${docs.pvLoading ? 1 : 0}">${docs.pvLoading ? `<p class="dim">${none('미리보기를 여는 중', '호스트가 점검을 다시 한다')}</p>` : ''}${err}<div class="buttons"><button type="button" class="btn ghost" data-pv="close">닫기</button></div></div>`; return; }
  const expired = pvExpired();
  const blocked = p.blockers.length > 0;
  const spent = !!p.spent;
  const off = blocked || expired || spent || docs.issuing;
  h.innerHTML = `<div class="dialog issue-pv" role="dialog" aria-modal="true" data-issue-preview data-label="${esc(p.label)}" data-expired="${expired ? 1 : 0}">`
    + `<h2>${esc(p.label)} 발행 — ${esc(p.caseName)}</h2>${err}`
    + `<div class="pv-cols"><div class="pv-left">`
    + `<div class="sec"><h4>발행을 막는 것 ${p.blockers.length}<span class="sp"></span><span class="faint">통과 ${p.passed.length}</span></h4>${blocked ? `<ul class="issrows">${noteRows(p.blockers, 'ng', 'data-blocker', true)}</ul>` : '<p class="dim" data-no-blockers>없음</p>'}</div>`
    + (p.warnings.length ? `<div class="sec"><h4>경고 ${p.warnings.length}</h4><ul class="issrows">${noteRows(p.warnings, 'warn', 'data-warning')}</ul></div>` : '')
    + `<div class="sec"><h4>통과 ${p.passed.length}</h4><p class="faint" data-pv-passed>${esc(passedNames(p).join(' · ') || '없음')}</p></div>`
    + `<div class="sec"><h4>차수 · 폴더</h4><p><b data-pv-revision>${esc(p.label)}</b> · <span class="num">${esc(p.folder)}/</span></p></div>`
    + `<div class="sec"><h4>묶일 파일</h4><ul class="notes" data-pv-files>${bundleRows(p) || '<li class="faint">초안 없음</li>'}</ul>`
    + `<p class="faint">초안 ${esc(p.draft?.item ?? '—')} 의 계산서를 도장만 바꿔 다시 그린 것 · 좌굴 해석 보고서 · 검증표 · 저장된 .csd · 목록 파일 — 발행 뒤에는 바꾸지 않는다</p></div>`
    + `<div class="sec" data-pv-meaning><h4>확인의 뜻</h4><p class="faint">${esc(rv.meaning || '')}</p></div>`
    + `</div><div class="pv-right"><div class="faint">최종본의 첫 쪽 — 발행 도장을 얹은 계산서(호스트의 stamped_doc)</div>`
    + (stampedPage(p) ? frame(stampedPage(p)!, p.draft?.item ?? '', '최종본 미리보기') : `<div class="ph-box">${none('초안이 없다', '계산서를 먼저 만든다')}</div>`)
    + `</div></div>`
    + `<div class="buttons">${expired || spent ? `${expired && !spent ? '<span class="warn" data-pv-expired>미리보기가 2 분을 넘었다 — 다시 연다</span>' : '<span class="faint">이 미리보기의 숫자는 끝났다 — 다시 연다</span>'}<button type="button" class="btn primary" data-pv="reopen">미리보기 다시</button>`
      : `<span class="faint">${docs.issuing ? '<span class="pulse"></span> 인쇄 중 — 호스트가 PDF 를 쓰는 동안 기다린다' : `${esc(new Date(p.expiresAt).toLocaleTimeString('ko-KR', { hour12: false }))} 까지`}</span>`
        + `<button type="button" class="btn primary" data-pv="issue"${off ? ' disabled' : ''}${tip(blocked ? '막는 것이 있으면 발행하지 않는다' : '발행한다 — 사람만')}>${esc(p.label)} 발행</button>`}`
    + `<button type="button" class="btn ghost" data-pv="close"${docs.issuing ? ' disabled' : ''}>닫기</button></div></div>`;
}
/**
 * 도장 찍힌 첫 쪽 — 호스트의 stamped_doc 을 다리가 호스트의 그리기 · 인쇄 틀로 그린 것(stamped_html — 발행 때와 같은 틀). 디스크의 초안 HTML 은 쓰지 않는다(S2)
 */
const stampedPage = (p: Preview): string | null => (typeof p.stamped_html === 'string' && p.stamped_html ? p.stamped_html : null);
function onPvClick(e: Event): void {
  const b = (e.target as HTMLElement).closest?.('[data-pv]');
  if (!b || (b as HTMLButtonElement).disabled) { return; }
  const what = b.getAttribute('data-pv');
  if (what === 'close') { closePreview(); return; }
  if (what === 'damage') { closePreview(); goDamage(); return; }
  if (what === 'reopen') { void openPreview(); return; }
  if (what === 'issue') { void doIssue(); }
}
/** 「R<n> 발행」 — 사람의 길(인쇄를 기다린다). 거절이면 그 까닭(부호)과 「미리보기 다시」 */
export async function doIssue(): Promise<void> {
  const p = docs.pv;
  if (!p || docs.issuing || p.blockers.length || pvExpired()) { return; }
  docs.issuing = true; renderPreview();
  progress({ id: 'issue', title: `${p.label} 발행 — 인쇄 중`, message: '호스트' });
  let r: Awaited<ReturnType<typeof person>>;
  try { r = await person('issue', { fingerprint: p.fingerprint, nonce: p.nonce }); } finally { docs.issuing = false; progress({ id: 'issue', done: true }); }
  if (r.ok) {
    closePreview();
    notify(`${p.label} 을(를) 발행했다 — ${String(r.data?.folder ?? '')}/ (파일 ${Array.isArray(r.data?.files) ? r.data.files.length : 0})`, 'info');
    await loadDocs(); rerender();
    return;
  }
  const code = String(r.code ?? 'host.issue.failed');
  docs.pvErr = { code, text: r.error ?? '발행하지 않았다' };
  if (docs.pv) { docs.pv.spent = true; }  // 숫자는 이미 썼다(한 번만) — 미리보기를 다시
  renderPreview();
  notify(r.error ?? '발행하지 않았다', 'warning');
}
/** 「초안으로 내보내기」 — 사람의 저장 대화상자 */
export async function doExport(item?: string): Promise<void> {
  const r = await person('export', item ? { item } : {});
  if (!r.ok) { notify(`내보내지 못했다 — ${r.error ?? ''}`, 'warning'); return; }
  notify(r.data?.cancelled ? '내보내기를 그만뒀다' : `「${String(r.data?.exported ?? '')}」(으)로 내보냈다 — 초안 ${String(r.data?.draft ?? '')}`, 'info');
}
/** 초안 · 발행본의 PDF 를 OS 의 기본 앱으로 */
export async function doOpen(item: string): Promise<void> {
  const r = await person('open-doc', { item });
  notify(r.ok ? (r.data?.opened ? `「${String(r.data.name)}」을(를) 열었다` : `「${String(r.data?.name ?? '')}」 — 이 환경에서는 OS 로 열지 않는다`) : `열지 못했다 — ${r.error ?? ''}`, r.ok ? 'info' : 'warning');
}
