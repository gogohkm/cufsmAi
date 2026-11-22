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

export interface StartHandlers {
  open(): void;
  review(): void;
  claude(op: 'connect' | 'disconnect'): void;
}

export function initStart(root: HTMLElement, h: StartHandlers): void {
  root.innerHTML = '<div class="start">'
    + '<h2>StCFSD <span class="faint" style="font-weight:400;font-size:13px">냉간성형강 단면 · 부재 검토</span></h2>'
    + `<div class="box recent"><h4><span${tip('검토 대상(.csd) 하나 = 단면 + 부재 조건 + 하중 + 검토. 최근 목록 · 프로젝트 폴더는 기록(R1)과 함께 생긴다')}>최근 검토</span><span class="sp"></span>`
    + `<button class="btn" data-act="open"${tip('.csd 파일을 연다')}>열기</button>`
    + `<button class="btn primary" data-act="review"${tip('지금 프로그램에 있는 모델을 검토 화면으로 본다')}>지금 모델 보기</button></h4>`
    + '<table class="t"><thead><tr><th></th><th>검토 대상</th><th>단면</th><th>진행</th><th>다음 판단</th><th class="r">마지막 작업</th></tr></thead><tbody class="rows"></tbody></table>'
    + `<div class="in foot"><a data-act="open"${tip('프로젝트 폴더 없이 .csd 하나만 연다. 작업 기록이 남지 않는다')}>파일만 열기 (.csd)</a><span class="faint where"></span></div></div>`
    + `<div class="box claude"><h4><span${tip('대화는 Claude Desktop 에서만 한다. StCFSD 에는 대화창이 없다')}>Claude Desktop 연결</span><span class="sp"></span><span class="verdict cl"></span></h4><div class="in steps"></div></div>`
    + `<div class="box newc-box" style="grid-column:1 / 3"><h4><span${tip('새 검토는 템플릿 하나로 시작한다. 나머지는 Claude 에게 말로 채운다')}>새 검토</span><span class="sp"></span></h4>`
    + '<div class="in newc">'
    + `<div class="off"${tip('검토 대상 템플릿은 프로젝트 기록(R1)과 함께 생긴다. 지금은 Claude 에게 말로 만든다')}><b>지붕 퍼린</b><span>연속 · 랩 · 데크</span></div>`
    + `<div class="off"${tip('검토 대상 템플릿은 프로젝트 기록(R1)과 함께 생긴다. 지금은 Claude 에게 말로 만든다')}><b>벽 거트</b><span>풍압 · 양압</span></div>`
    + `<div class="off"${tip('검토 대상 템플릿은 프로젝트 기록(R1)과 함께 생긴다. 지금은 Claude 에게 말로 만든다')}><b>바닥 장선 · 스터드</b><span>휨 · 압축</span></div>`
    + `<div data-act="review"${tip('지금 모델로 검토 화면을 연다. 단면은 Claude 에게 말로 바꾼다')}><b>단면만</b><span>좌굴 해석 · DSM 값</span></div>`
    + '</div></div></div>';
  root.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const c = t.closest('[data-claude]') as HTMLElement | null;
    if (c) { const op = c.getAttribute('data-claude'); if (op === 'connect' || op === 'disconnect') { h.claude(op); } return; }
    const a = t.closest('[data-act]');
    if (!a) { return; }
    if (a.getAttribute('data-act') === 'open') { h.open(); } else if (a.getAttribute('data-act') === 'review') { h.review(); }
  });
}

/** 지금 모델 한 줄 — 호스트의 모델과 진행 띠. 파일이 없으면 이름 칸에 「파일 없음」 */
export function renderStart(root: HTMLElement, claude: ClaudeStatus | null): void {
  const rows = root.querySelector('.rows');
  if (rows) {
    const f = state.full;
    const def = isDefault('section');
    const mini = state.nodes.length ? sectionSvg({ w: 120, h: 120, nodes: state.nodes, elems: state.elems, mini: true }) : '';
    const done = (['fsm', 'chk'] as const).filter(k => state.stages[k].state === 'ok').length;
    rows.innerHTML = `<tr class="on" data-act="review"${tip('누르면 검토 화면')}>`
      + `<td><div class="mini-sec dv">${mini}</div></td>`
      + `<td><b>${esc(state.file.name ?? '지금 모델')}</b><div class="faint">${esc(state.file.name ? '열린 파일' : def ? '프로그램 기본 단면 · 파일 없음' : '파일 없음')}</div></td>`
      + `<td>${esc(sectionLabel())}<div class="faint">${f ? `절점 ${esc(f.nnodes)} · 요소 ${esc(f.nelems)}` : '모델 읽는 중'}</div></td>`
      + `<td>${pipeHtml(true)}<div class="faint">${done ? `결과 ${done}` : '결과 없음'}</div></td>`
      + `<td><span class="dot"></span> <span${tip('판단 요청 · 보고는 기록(R3)부터 생긴다')}>기록 없음</span></td>`
      + `<td class="r">${claude?.lastAiCall ? `${esc(hhmm(claude.lastAiCall.at))}<div class="faint">AI</div>` : '<span class="faint">—</span>'}</td></tr>`;
  }
  const where = root.querySelector('.where') as HTMLElement | null;
  if (where) { where.textContent = state.file.path ?? '열린 파일 없음'; }
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
  return step(reg, 1, regText, `「연결」을 누르면 Claude 설정을 보고, 없으면 추가하고, 있으면 지금 설치본을 가리키는지 확인한다. 다른 항목은 건드리지 않는다${s?.configPath ? ` · ${s.configPath}` : ''}`, btn)
    + step(reg && !s?.restartNeeded, 2, 'Claude Desktop 다시 시작', '등록한 뒤 한 번 다시 시작해야 Claude 가 StCFSD 도구를 본다',
      `<span class="faint">${reg ? (s?.restartNeeded ? '필요' : '—') : '—'}</span>`)
    + step(!!s?.lastAiCall, 3, '마지막 호출', 'Claude 가 StCFSD 도구를 마지막으로 부른 시각. 한 번도 없으면 「아직 호출 없음」',
      `<span class="faint">${s?.lastAiCall ? `${esc(hhmm(s.lastAiCall.at))} · ${esc(s.lastAiCall.action ?? s.lastAiCall.endpoint)}` : '아직 호출 없음'}</span>`);
}
