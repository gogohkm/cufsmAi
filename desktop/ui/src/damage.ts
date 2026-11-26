/**
 * V9b-04 · D1 — 기록 손상을 사람이 푼다(호스트 bc8c194 의 `person.recordsDamage` · `person.resolveDamage`).
 *
 *  - 목록은 다리의 `GET /api/person/damage`(믿는 작성자의 손상된 줄 파일 — 종류 · 줄 파일 이름 · 작성자 · 깨진 줄 · 틈 · 줄어듦). 경로는 오지 않는다.
 *  - 푸는 길 둘은 사람의 길로만(`POST /api/person/damage/resolve {type, stream, action}` — 쓰기 열쇠 · 맨 위 틀). 다리가 실행 전에 묻는다(격리 · 받아들이기 · 취소):
 *    격리(quarantine) = 그 줄 파일을 .stcfsd/quarantine/ 로 옮기고 서명된 한 줄, 받아들이기(accept) = 백업에서 되살린 줄어든 줄 파일의 지금 끝을 받아들인다
 *    (줄어들기만 하고 온전한 줄 파일에만 — 호스트의 규칙, 다리도 본다).
 *  - 띠(「기록 손상」)와 문서 탭의 줄 「기록 손상」이 여기로 이끈다. 발행이 「기록 손상」으로 막혔으면 그 막는 것의 줄 · 미리보기가 여기로 이끈다.
 *  - 화면은 손상을 스스로 판단하지 않는다 — 호스트가 준 목록 그대로. 글은 dom.esc 를 거친다(작성자 이름은 그 작성자가 스스로 적은 것).
 */
import { api } from './bridge';
import { esc, tip } from './dom';
import { hostText } from './notices';
import { person } from './records';

export interface DamageItem {
  type: string; stream: string; writer: string; own: boolean; broken: number; chain_breaks: number;
  shrunk: { expected_seq: number; found_seq: number } | null; can_accept: boolean;
}
export const dmg: { items: DamageItem[]; loaded: boolean; err?: string; busy: string } = { items: [], loaded: false, busy: '' };

/** 기록의 종류 → 한국어(다리의 DAMAGE_TYPE_KO 와 같은 말) */
export const DAMAGE_TYPE_KO: Record<string, string> = { cases: '대상', changes: '변경', runs: '실행', work: '업무', assumptions: '가정', sources: '원자료', reviews: '확인', alternatives: '대안', documents: '문서' };

let seq = 0;
/** 프로젝트가 열려 있을 때 — 다리의 사람 얼굴에서(프로젝트가 없으면 빈 목록) */
export async function loadDamage(inProject: boolean): Promise<void> {
  if (!inProject) { dmg.items = []; dmg.loaded = false; dmg.err = undefined; return; }
  const n = ++seq;
  const r = await api<any>('GET', '/api/person/damage');
  if (n !== seq) { return; }
  if (r.success) { dmg.items = Array.isArray(r.data?.items) ? r.data.items : []; dmg.err = undefined; } else { dmg.items = []; dmg.err = String(r.error ?? '읽지 못함'); }
  dmg.loaded = true;
}

/** 손상의 짧은 글 — 깨진 줄 · 틈 · 줄어듦 */
export function damageWhat(d: DamageItem): string {
  return [d.broken ? `깨진 줄 ${d.broken}` : '', d.chain_breaks ? `틈 ${d.chain_breaks}` : '', d.shrunk ? `줄어듦 ${d.shrunk.expected_seq} → ${d.shrunk.found_seq}` : ''].filter(Boolean).join(' · ') || '손상';
}
const HOST_WHY = (): string => hostText('host.issue.damaged-records')
  || '믿는 작성자의 기록이 손상되었습니다 — 손상된 줄 파일을 옆으로 옮기거나(격리) 백업에서 되살린 줄어든 줄 파일을 받아들이십시오(사람만).';

/** 띠 — 손상이 있으면(프로젝트 안) */
export function damageBand(): { kind: string; html: string } | null {
  if (!dmg.items.length) { return null; }
  return { kind: 'damage', html: `<b data-band="damage">기록 손상</b><span${tip(HOST_WHY())}> — 믿는 작성자의 줄 파일 ${dmg.items.length}개가 손상되었다 · 풀 때까지 발행이 막힌다</span><span class="sp"></span>`
    + `<span class="btn" data-rec="damage"${tip('손상된 줄 파일의 목록과 두 길(격리 · 받아들이기) — 사람만, 실행 전에 묻는다')}>손상 보기</span>` };
}

/** 가운데 — 목록과 두 길(줄마다) */
export function damageView(): string {
  const rows = dmg.items.map(d => `<tr data-dmg="${esc(`${d.type}/${d.stream}`)}"><td>${esc(DAMAGE_TYPE_KO[d.type] ?? d.type)}</td>`
    + `<td class="num"${tip('줄 파일 이름(작성자 id — 프로젝트의 .stcfsd/records 안)')}>${esc(d.stream)}</td>`
    + `<td>${esc(d.writer || '—')}${d.own ? ' <span class="tag">이 PC</span>' : ''}</td>`
    + `<td data-dmg-what>${esc(damageWhat(d))}</td>`
    + `<td class="btns" style="white-space:nowrap"><span class="btn${dmg.busy ? ' off' : ''}" data-dmg-act="quarantine" data-dmg-type="${esc(d.type)}" data-dmg-stream="${esc(d.stream)}"${tip('그 줄 파일을 .stcfsd/quarantine/ 로 옮긴다(지우지 않는다) — 묻는다. 그 줄 파일의 기록은 빠지고, 옮겼다는 서명된 한 줄이 남는다')}>격리</span>`
    + (d.can_accept ? ` <span class="btn ghost${dmg.busy ? ' off' : ''}" data-dmg-act="accept" data-dmg-type="${esc(d.type)}" data-dmg-stream="${esc(d.stream)}"${tip('백업에서 되살린 줄어든 줄 파일의 지금 끝을 받아들인다 — 묻는다. 빠진 줄은 없는 것으로 본다')}>받아들이기</span>` : '')
    + `</td></tr>`).join('');
  const body = dmg.err ? `<p class="warn">목록을 읽지 못함 — ${esc(dmg.err)}</p>`
    : dmg.items.length ? `<table class="t" data-table="damage"><thead><tr><th>기록</th><th>줄 파일</th><th>작성자</th><th>손상</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="dim" data-dmg-none>손상된 기록이 없다</p>`;
  return `<div class="dv docv" data-damage-view="${dmg.items.length}"><div class="doc-body" style="padding:16px;overflow:auto;height:100%">`
    + `<div class="banner warn" style="margin-bottom:12px">${esc(HOST_WHY())}</div>${body}`
    + `<p class="faint" style="margin-top:12px">파일을 손으로 고치지 않는다 — 격리는 옆으로 옮길 뿐 지우지 않는다(.stcfsd/quarantine/). 받아들이기는 줄어들기만 하고 그 밖에는 온전한 줄 파일에만 보인다. 둘 다 누가 · 언제 했는지 서명된 한 줄이 대상 기록에 남는다</p></div></div>`;
}

/** 정보 창 — 몇 개 · 왜 막는가 */
export function damageInfo(): string {
  const n = dmg.items.length;
  return `<div class="hd"><div class="k">기록 · 손상<span class="sp"></span><span class="verdict ${n ? 'ng' : 'ok'}" data-dmg-count="${n}">${n ? `${n}개` : '없음'}</span></div>`
    + `<div class="ttl">기록 손상</div><div class="dim">${n ? '풀 때까지 발행이 막힌다(호스트의 발행 전 점검 「기록 손상」)' : '믿는 작성자의 줄 파일이 모두 온전하다'}</div></div>`
    + (n ? `<div class="sec"><h4>줄 파일<span class="sp"></span></h4><ul class="notes">${dmg.items.map(d => `<li>${esc(DAMAGE_TYPE_KO[d.type] ?? d.type)} · ${esc(d.writer || d.stream)} — ${esc(damageWhat(d))}</li>`).join('')}</ul></div>` : '')
    + `<div class="sec"><h4>두 길<span class="sp"></span></h4><ul class="notes"><li><b>격리</b> — 그 줄 파일을 옆으로 옮긴다(깨진 줄 · 틈이 있는 것)</li><li><b>받아들이기</b> — 백업에서 되살린 줄어든 줄 파일의 지금 끝을 받아들인다</li></ul><p class="faint">사람만 — 다리가 실행 전에 묻는다. AI 의 도구로는 할 수 없다</p></div>`;
}

/** 「격리」 · 「받아들이기」 — 사람의 길. 다리가 묻는다(취소면 아무것도 하지 않는다) */
export async function resolveDamage(type: string, stream: string, action: 'quarantine' | 'accept'): Promise<{ ok: boolean; cancelled?: boolean; text: string }> {
  if (dmg.busy) { return { ok: false, text: '앞의 요청을 기다린다' }; }
  dmg.busy = `${type}/${stream}`;
  try {
    const r = await person('damage/resolve', { type, stream, action });
    if (!r.ok) { return { ok: false, text: `하지 못했다 — ${r.error ?? ''}` }; }
    if (r.data?.cancelled) { return { ok: true, cancelled: true, text: '그만뒀다' }; }
    return { ok: true, text: action === 'quarantine' ? `격리했다 — ${String(r.data?.moved_to ?? '')} (파일 ${Number(r.data?.files ?? 0)})` : '줄어든 기록을 받아들였다' };
  } finally { dmg.busy = ''; }
}
