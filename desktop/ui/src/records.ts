/**
 * 기록 갈래 R1-3 — 프로젝트 · 검토 대상이 화면에(기록 설계 §5.3 · 템플릿 00).
 *
 *  - 수 · 목록은 호스트가 준 것만: `get_full_state.project`(지금 프로젝트 · 대상 · 읽기 전용 · 잠금), 호스트 동작 `list_cases`(대상 목록 —
 *    색인의 단면 · 강종 · 최대 판정비 · 마지막 저장), `get_case_status`(결과 상태 · 밖에서 바뀜), 다리 `GET /api/person/recent`(최근 · 뿌리의
 *    프로젝트 — list_projects). 화면은 세지 않는다.
 *  - 사람만 하는 일 · 대상을 바꾸는 일은 다리의 `/api/person/*`(쓰기 열쇠 — 창에서는 사람의 입력 뒤 2 초 안에만): 폴더에서 열기 · 새 프로젝트 ·
 *    프로젝트 열기 · 대상 열기(저장 안 한 변경을 먼저 묻는다) · 새 검토(카드) · 프로젝트로 만들기 · 잠금 넘겨받기 · 보관. 경로를 보내지 않는다.
 *  - 띠: 프로젝트 밖(「작업 기록이 남지 않음」 · 「프로젝트로 만들기」), 읽기 전용 · 잠금(까닭 · 「새 검토 대상으로」 · 「넘겨받기」),
 *    밖에서 바뀐 파일(「다른 이름으로 저장」 · 「덮어쓰기」(호스트에 바람 — 꺼짐) · 「취소」).
 */
import { api, mcp } from './bridge';
import { esc, tip } from './dom';
import { state } from './store';

export interface RecCase { name: string; kind: string; open: boolean; archived?: boolean; missing?: boolean; last_saved: string | null; section: string | null; steel: string | null; max_ratio: number | null; pass: boolean | null }
export interface RecState {
  cases: RecCase[] | null;
  unregistered: Array<{ name: string }>;
  status: any | null;
  recent: Array<{ name: string; cases: number; last_work: string | null; open: boolean }> | null;
  recentAt: number;
  err?: string;
  /** 「밖에서 바뀜」 물음을 닫은 판(같은 상태에서 다시 띄우지 않는다) */
  outsideDismissed: string;
}
export const rec: RecState = { cases: null, unregistered: [], status: null, recent: null, recentAt: 0, outsideDismissed: '' };

export const KIND_KO: Record<string, string> = { 'roof-purlin': '지붕 퍼린', 'wall-girt': '벽 거트', 'floor-joist': '바닥 장선', 'wall-stud': '스터드', 'section-only': '단면만' };
const RO_KO: Record<string, string> = {
  'issued-copy': '발행본이다 — 읽기 전용(고치려면 새 검토 대상으로)', 'locked-here': '이 PC 의 다른 창이 잠그고 있다',
  'locked-elsewhere': '다른 PC 가 잠그고 있다', 'locked-by-other-writer': '다른 작성자가 잠그고 있다', 'lock-unreadable': '잠금 파일을 읽을 수 없다',
  'newer-records': '이 프로그램보다 새 판이 쓴 기록이 있다', 'declaration-newer': '프로젝트 선언이 이 프로그램보다 새 판이다',
  'hard-link': '파일이 하드 링크다', link: '파일이 링크다', 'protected-folder': '보호된 폴더 안이다', 'not-a-case-file': '검토 대상 파일이 아니다',
  'records-unavailable': '기록을 쓸 수 없다(열쇠 자리가 없다)',
};
export const roText = (r: unknown): string => RO_KO[String(r ?? '')] ?? String(r ?? '읽기 전용');

/** 지금 프로젝트(호스트) — get_full_state.project */
export const project = (): any => state.full?.project ?? null;

/** 호스트에서 다시 읽는다(프로젝트가 열려 있을 때만 대상 목록 · 상태) */
export async function loadRecords(): Promise<void> {
  const p = project();
  if (!p?.inProject) { rec.cases = null; rec.unregistered = []; rec.status = null; return; }
  const [lc, cs] = await Promise.all([mcp<any>('list_cases', {}), mcp<any>('get_case_status', {})]);
  if (lc && !lc.error) { rec.cases = Array.isArray(lc.cases) ? lc.cases : []; rec.unregistered = Array.isArray(lc.unregistered) ? lc.unregistered : []; rec.err = undefined; }
  else { rec.err = String(lc?.error ?? '대상 목록을 읽지 못함'); }
  rec.status = cs && !cs.error ? cs : null;
}
/** 최근 · 뿌리의 프로젝트(다리 — list_projects). 시작 화면 · 제목 표시줄의 목록을 열 때 */
export async function loadRecent(force = false): Promise<void> {
  if (!force && rec.recent && Date.now() - rec.recentAt < 5000) { return; }
  const r = await api<any>('GET', '/api/person/recent');
  rec.recent = r.success && Array.isArray(r.data?.projects) ? r.data.projects : [];
  rec.recentAt = Date.now();
}

/** 사람만 하는 일 — 다리 `/api/person/<name>`. 답의 오류는 그대로 돌려준다 */
export async function person(name: string, body: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: any; error?: string; status: number }> {
  const r = await api<any>('POST', `/api/person/${name}`, body);
  return { ok: r.success, data: r.data, error: r.error, status: r.status };
}

// ── 띠 ─────────────────────────────────────────────────────────────
/** 제목 표시줄 아래 띠 하나 — 프로젝트 밖 · 읽기 전용(잠금) · 밖에서 바뀜. 없으면 '' */
export function bandHtml(): { kind: string; html: string } | null {
  const p = project();
  const fileOpen = !!state.file.name;
  if (!p?.inProject) {
    if (!fileOpen) { return null; }
    return { kind: 'outside', html: `<b data-band="outside">프로젝트 밖</b><span${tip('이 파일은 프로젝트 폴더에 없다 — 작업 기록(누가 · 언제 · 무엇을 돌렸나)이 남지 않는다. 변경은 이 세션에만')}> — 작업 기록이 남지 않음</span><span class="sp"></span>`
      + `<span class="btn" data-rec="make-project"${tip('지금 파일을 열린 프로젝트의 새 검토 대상으로 복사한다(원본은 그대로). 열린 프로젝트가 없으면 먼저 고르거나 만든다')}>프로젝트로 만들기</span>` };
  }
  // 대상이 아닌 채로 읽기 전용으로 연 파일(발행본 · 02 밖의 .csd) — 호스트가 `file_read_only {reason, detail}` 로 알리면(바라는 칸)
  const fro = p.file_read_only;
  const c = p.case ?? (fro ? { name: state.file.name, readOnly: true, readOnlyReason: fro.reason, lock: null } : null);
  if (c?.readOnly) {
    const lock = c.lock ? `${esc(c.lock.name)} · ${esc(c.lock.host)} · ${esc(fmtWhen(c.lock.since))} 부터` : '';
    // 호스트는 읽기 전용 대상에서 입력 · 모델 편집(MCP 의 모델 동작 20 · 화면의 모델 편집)과 파일의 모델과 다른 해석 실행을 받지 않는다(a730256)
    return { kind: 'readonly', html: `<b data-band="readonly">읽기 전용</b><span data-ro-reason="${esc(c.readOnlyReason ?? '')}"> — ${esc(roText(c.readOnlyReason))}${lock ? ` (${lock})` : ''}</span>`
      + `<span class="faint" data-ro-scope${tip('호스트가 거절한다 — 사람의 편집 상태 · AI 의 도구 모두. 저장도 되지 않는다. 이 파일의 결과를 보는 것 · 같은 모델로 다시 해석하는 것은 된다')}> · 입력 · 모델을 고치거나 다른 모델로 해석을 돌려도 받지 않는다</span><span class="sp"></span>`
      + `<span class="btn" data-rec="as-new"${tip('지금 값을 이 프로젝트의 새 검토 대상으로 복사해 거기서 고친다(이 파일은 그대로)')}>새 검토 대상으로</span>`
      + (c.lock ? `<span class="btn ghost" data-rec="take-lock"${tip('다른 곳의 잠금을 넘겨받는다 — 그쪽의 저장은 거절된다(묻는다)')}>넘겨받기</span>` : '') };
  }
  const st = rec.status;
  const key = `${c?.name ?? ''}|${st?.saved_at ?? ''}`;
  if (c && st?.changed_outside_since_save && rec.outsideDismissed !== key) {
    return { kind: 'outside-change', html: `<b data-band="outside-change">밖에서 바뀜</b><span> — 저장한 뒤 이 파일이 다른 곳에서 바뀌었다. 저장하면 그 변경을 덮는다</span><span class="sp"></span>`
      + `<span class="btn" data-rec="save-as"${tip('다른 이름으로 저장 — 밖의 변경은 그 파일에 그대로')}>다른 이름으로 저장</span>`
      + `<span class="btn off" data-rec="overwrite" aria-disabled="true"${tip('밖의 변경을 덮어쓰고 저장 — 호스트가 아직 그 길을 주지 않는다(사람만 하는 일로 바란다)')}>덮어쓰기</span>`
      + `<span class="btn ghost" data-rec="dismiss"${tip('지금은 저장하지 않는다')}>취소</span>`, };
  }
  return null;
}

// ── 시작 화면(템플릿 00) ─────────────────────────────────────────────
const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) { return '—'; }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) { return '—'; }
  const now = new Date();
  return d.toDateString() === now.toDateString() ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 최근 검토의 줄 — 프로젝트가 열려 있으면 그 대상들(list_cases), 아니면 최근 프로젝트(누르면 연다) */
export function startRows(): { rows: string; foot: string; inProject: boolean } {
  const p = project();
  if (p?.inProject) {
    const list = rec.cases ?? [];
    const rows = list.map(c => {
      const ratio = typeof c.max_ratio === 'number' ? `최대 ${c.max_ratio.toFixed(2)}` : '결과 없음';
      const v = c.pass === true ? 'ok' : c.pass === false ? 'ng' : 'un';
      return `<tr class="${c.open ? 'on' : ''}" data-rec="open-case" data-name="${esc(c.name)}"${tip(c.missing ? '파일이 없다 — 옮겼거나 지웠다' : '누르면 이 검토 대상을 연다')}>`
        + `<td><div class="mini-sec dv rec-mini"><span class="faint">${esc((KIND_KO[c.kind] ?? c.kind).slice(0, 2))}</span></div></td>`
        + `<td><b>${esc(c.name)}</b>${c.missing ? ' <span class="tag def">파일 없음</span>' : ''}<div class="faint">${esc(p.project?.name ?? '')} · ${esc(KIND_KO[c.kind] ?? c.kind)}</div></td>`
        + `<td>${esc(c.section ?? '—')}<div class="faint">${esc(c.steel ?? '')}${c.steel ? ' · ' : ''}<span class="verdict ${v}" data-ratio>${esc(ratio)}</span></div></td>`
        + `<td><span class="faint"${tip('결과마다의 일치 · 낡음은 그 대상을 열면 진행 띠에 — 목록의 진행은 색인에 아직 없다(호스트에 바람)')}>—</span></td>`
        + `<td><span class="dot"></span> <span${tip('판단 요청 · 보고는 기록(R3)부터 생긴다')}>기록 없음</span></td>`
        + `<td class="r" data-last="${esc(c.last_saved ?? '')}">${esc(fmtWhen(c.last_saved))}<div class="faint">저장</div></td></tr>`;
    }).join('');
    const unreg = rec.unregistered.length ? `<tr><td></td><td colspan="5" class="faint">등록되지 않은 파일 ${rec.unregistered.length} — ${esc(rec.unregistered.slice(0, 3).map(u => u.name).join(', '))}</td></tr>` : '';
    return { inProject: true, rows: (rows || `<tr><td></td><td colspan="5" class="faint">이 프로젝트에 검토 대상이 없다 — 아래 「새 검토」</td></tr>`) + unreg,
      foot: `<span data-foot-project>${esc(p.project?.name ?? '')}</span> · 검토 대상 <b data-foot-count>${list.length}</b>${p.project?.readOnly ? ' · 읽기 전용' : ''}` };
  }
  const rp = rec.recent ?? [];
  const rows = rp.map(r => `<tr data-rec="open-project" data-name="${esc(r.name)}"${tip('누르면 이 프로젝트를 연다(검토 대상은 그다음에 고른다)')}><td><div class="mini-sec dv rec-mini"><span class="faint">폴더</span></div></td>`
    + `<td><b>${esc(r.name)}</b><div class="faint">프로젝트</div></td><td class="faint">검토 대상 ${esc(r.cases)}</td><td></td><td></td><td class="r">${esc(fmtWhen(r.last_work))}</td></tr>`).join('');
  return { inProject: false, rows, foot: rp.length ? `<span class="faint">최근 프로젝트 ${rp.length}</span>` : '<span class="faint">열린 프로젝트 없음 — 「폴더에서 열기」 · 「새 프로젝트」</span>' };
}

/** 제목 표시줄의 프로젝트 · 대상 글 */
export function titleParts(): { project: string | null; caseName: string | null; inProject: boolean } {
  const p = project();
  return { project: p?.project?.name ?? null, caseName: p?.case?.name ?? null, inProject: !!p?.inProject };
}
