/**
 * 시작 화면(템플릿 00) — 파일을 아직 열지 않았을 때. 지금 프로그램에 있는 모델 한 줄(작은 단면 그림 · 진행 띠),
 * 「파일만 열기 (.csd)」, 새 검토, Claude Desktop 연결 세 단계.
 *
 * 최근 검토 목록 · 프로젝트 폴더는 기록 갈래(R1)가 만든다 — 지금 호스트에는 없다. 그래서 목록에는 지금 모델 한 줄만 있고,
 * 새 검토의 템플릿 넷 가운데 「단면만」만 된다(나머지는 R1 전에는 Claude 에게 말로).
 */
import { esc, tip } from './dom';
import { hhmm } from './format';
import { sectionLabel } from './names';
import { sectionSvg } from './section';
import { isDefault, state } from './store';
import { pipeHtml, type ClaudeStatus } from './titlebar';
import { startRows } from './records';

export interface StartHandlers {
  open(): void;
  review(): void;
  claude(op: 'connect' | 'disconnect'): void;
  /** R1-3: 기록의 일(폴더에서 열기 · 새 프로젝트 · 대상 열기 · 프로젝트 열기 · 새 검토) — data-rec 이름과 그 줄의 data-* */
  rec(act: string, el: HTMLElement): void;
}

const card = (kind: string, title: string, sub: string, t: string) => `<div data-rec="new-case" data-kind="${kind}"${tip(t)}><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;

export function initStart(root: HTMLElement, h: StartHandlers): void {
  root.innerHTML = '<div class="start">'
    + '<h2>StCFSD <span class="faint" style="font-weight:400;font-size:13px">냉간성형강 단면 · 부재 검토</span></h2>'
    + `<div class="box recent"><h4><span${tip('검토 대상(.csd) 하나 = 단면 + 부재 조건 + 하중 + 검토. 프로젝트 폴더 안의 대상은 작업 기록이 남는다')}>최근 검토</span><span class="sp"></span>`
    + `<button class="btn" data-rec="open-folder"${tip('폴더를 골라 프로젝트로 연다(OS 폴더 물음)')}>폴더에서 열기</button>`
    + `<button class="btn ghost" data-rec="new-project"${tip('프로젝트 뿌리(문서 › StCFSD 프로젝트) 아래에 새 프로젝트를 만든다(이름을 묻는다)')}>새 프로젝트</button>`
    + `<button class="btn primary" data-rec="to-cards"${tip('아래 「새 검토」의 카드로 — 부재 유형 하나로 새 검토 대상을 만든다')}>새 검토</button></h4>`
    + '<table class="t"><thead><tr><th></th><th>검토 대상</th><th>단면</th><th>진행</th><th>다음 판단</th><th class="r">마지막 작업</th></tr></thead><tbody class="rows"></tbody></table>'
    + `<div class="in foot"><a data-act="open"${tip('프로젝트 폴더 없이 .csd 하나만 연다. 작업 기록이 남지 않는다')}>파일만 열기 (.csd)</a><span class="faint where"></span></div></div>`
    + `<div class="box claude"><h4><span${tip('대화는 Claude Desktop 에서만 한다. StCFSD 에는 대화창이 없다')}>Claude Desktop 연결</span><span class="sp"></span><span class="verdict cl"></span></h4><div class="in steps"></div></div>`
    + `<div class="box newc-box" style="grid-column:1 / 3"><h4><span${tip('새 검토는 부재 유형 하나로 시작한다(값은 표의 처음 값). 열린 프로젝트 안에 만든다')}>새 검토</span><span class="sp"></span></h4>`
    + '<div class="in newc">'
    + card('roof-purlin', '지붕 퍼린', '연속 · 랩 · 데크', '지붕 퍼린 — 부재 유형만 정한 새 검토 대상(이름을 묻는다)')
    + card('wall-girt', '벽 거트', '풍압 · 양압', '벽 거트 — 부재 유형만 정한 새 검토 대상')
    + `<div class="two"${tip('바닥 장선 · 스터드 — 둘 가운데 하나를 누른다')}><b>바닥 장선 · 스터드</b><span><a data-rec="new-case" data-kind="floor-joist">바닥 장선</a> · <a data-rec="new-case" data-kind="wall-stud">스터드</a></span></div>`
    + card('section-only', '단면만', '좌굴 해석 · DSM 값', '단면만 — 부재 유형 없이(프로젝트가 없으면 지금 모델로 검토 화면)')
    + '</div></div></div>';
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const c = t.closest('[data-claude]') as HTMLElement | null;
    if (c) { const op = c.getAttribute('data-claude'); if (op === 'connect' || op === 'disconnect') { h.claude(op); } return; }
    const r = t.closest('[data-rec]') as HTMLElement | null;
    if (r) {
      if (r.getAttribute('data-rec') === 'to-cards') { root.querySelector('.newc-box')?.scrollIntoView({ block: 'nearest' }); (root.querySelector('.newc [data-rec]') as HTMLElement | null)?.focus?.(); return; }
      h.rec(r.getAttribute('data-rec')!, r);
      return;
    }
    const a = t.closest('[data-act]');
    if (!a) { return; }
    if (a.getAttribute('data-act') === 'open') { h.open(); } else if (a.getAttribute('data-act') === 'review') { h.review(); }
  });
}

/** 시작 화면 — 프로젝트가 열려 있으면 그 대상들(호스트의 list_cases), 아니면 최근 프로젝트와 지금 모델 한 줄 */
export function renderStart(root: HTMLElement, claude: ClaudeStatus | null): void {
  const rows = root.querySelector('.rows');
  const sr = startRows();
  if (rows) {
    const f = state.full;
    const def = isDefault('section');
    const mini = state.nodes.length ? sectionSvg({ w: 120, h: 120, nodes: state.nodes, elems: state.elems, mini: true }) : '';
    const done = (['fsm', 'chk'] as const).filter(k => state.stages[k].state === 'ok').length;
    // 프로젝트 밖: 지금 모델(프로그램이 쥔 것) 한 줄을 맨 위에 — 누르면 검토 화면
    const current = sr.inProject ? '' : `<tr class="on" data-act="review"${tip('누르면 검토 화면')}>`
      + `<td><div class="mini-sec dv">${mini}</div></td>`
      + `<td><b>${esc(state.file.name ?? '지금 모델')}</b><div class="faint">${esc(state.file.name ? '열린 파일 · 프로젝트 밖' : def ? '프로그램 기본 단면 · 파일 없음' : '파일 없음')}</div></td>`
      + `<td>${esc(sectionLabel())}<div class="faint">${f ? `절점 ${esc(f.nnodes)} · 요소 ${esc(f.nelems)}` : '모델 읽는 중'}</div></td>`
      + `<td>${pipeHtml(true)}<div class="faint">${done ? `결과 ${done}` : '결과 없음'}</div></td>`
      + `<td><span class="dot"></span> <span${tip('판단 요청 · 보고는 기록(R3)부터 생긴다')}>기록 없음</span></td>`
      + `<td class="r">${claude?.lastAiCall ? `${esc(hhmm(claude.lastAiCall.at))}<div class="faint">AI</div>` : '<span class="faint">—</span>'}</td></tr>`;
    rows.innerHTML = current + sr.rows;
  }
  const where = root.querySelector('.where') as HTMLElement | null;
  if (where) { where.innerHTML = sr.foot; }
  root.querySelectorAll('.newc [data-rec="new-case"]').forEach(el => {
    const k = el.getAttribute('data-kind');
    el.classList.toggle('off', !sr.inProject && k !== 'section-only');
  });
  const steps = root.querySelector('.steps') as HTMLElement | null;
  if (steps) { steps.innerHTML = claudeSteps(claude); }
  const v = root.querySelector('.verdict.cl') as HTMLElement | null;
  if (v) {
    const ok = claude?.ui === 'connected';
    v.className = `verdict cl ${ok ? 'ok' : claude && ['registered', 'restart-needed'].includes(claude.ui) ? 'warn' : 'un'}`;
    v.textContent = `● ${claude ? (ok ? '연결됨' : claude.text) : '확인 중'}`;
  }
}

/** 세 단계(템플릿 00) — S4 의 상태에서. 「연결」 · 「끊기」는 제목 표시줄과 같은 길 */
function claudeSteps(s: ClaudeStatus | null): string {
  const reg = !!s && (s.canDisconnect || ['registered', 'restart-needed', 'connected'].includes(s.ui));
  const regText = !s ? '확인 중' : s.ui === 'not-installed' ? 'Claude Desktop 없음' : s.ui === 'invalid-config' ? '설정 파일을 읽을 수 없음'
    : s.ui === 'registered-elsewhere' ? '다른 설치를 가리킴' : reg ? '설정에 등록됨' : '등록 안 됨';
  const btn = s?.canDisconnect ? '<button class="btn" data-claude="disconnect">끊기</button>'
    : `<button class="btn${s?.canConnect ? ' primary' : ' off'}" data-claude="connect"${s?.canConnect ? '' : ' disabled'}>연결</button>`;
  const step = (done: boolean, n: number, label: string, t: string, right: string) =>
    `<div class="step${done ? ' done' : ''}"><span class="n">${n}</span><b${tip(t)}>${esc(label)}</b>${right}</div>`;
  // 설정을 손댈 수 없는 까닭(같은 이름 두 번 · JSON 아님 …)은 다리가 상태의 풍선 도움말에 사람 말로 준다
  if (s?.ui === 'invalid-config') { return step(false, 1, regText, s.tooltip || regText, btn); }
  return step(reg, 1, regText, `「연결」을 누르면 Claude 설정을 보고, 없으면 추가하고, 있으면 지금 설치본을 가리키는지 확인한다. 다른 항목은 건드리지 않는다${s?.configPath ? ` · ${s.configPath}` : ''}`, btn)
    + step(reg && !s?.restartNeeded, 2, 'Claude Desktop 다시 시작', '등록한 뒤 한 번 다시 시작해야 Claude 가 StCFSD 도구를 본다',
      `<span class="faint">${reg ? (s?.restartNeeded ? '필요' : '—') : '—'}</span>`)
    + step(!!s?.lastAiCall, 3, '마지막 호출', 'Claude 가 StCFSD 도구를 마지막으로 부른 시각. 한 번도 없으면 「아직 호출 없음」',
      `<span class="faint">${s?.lastAiCall ? `${esc(hhmm(s.lastAiCall.at))} · ${esc(s.lastAiCall.action ?? s.lastAiCall.endpoint)}` : '아직 호출 없음'}</span>`);
}
