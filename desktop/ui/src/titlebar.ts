/**
 * 제목 표시줄 — StCFSD · 검토 대상 ▾(파일 · 열기 · 저장) · 진행 띠 | 편집 F2 · Claude 연결 상태 · 「연결」/「끊기」.
 * 단추는 사람만 하는 일뿐이다(열기 · 저장 · 편집 상태 · Claude 연결). 해석 실행 · 값 수정 단추는 없다.
 * 찾기(Ctrl+F) · AI 따라가기(켜고 끄기 — 켜 두면 AI 의 focus 요청을 따른다, 구성안 3.9)도 보는 일이다.
 */
import { tip } from './dom';
import { openMenu } from './menu';
import { state, type Stage } from './store';

export interface ClaudeStatus {
  state: string; ui: string; text: string; tooltip: string; canConnect: boolean; canDisconnect: boolean; restartNeeded: boolean;
  lastAiCall: { at: string; client: string; method: string; endpoint: string; action?: string } | null; aiCalls: number;
  configPath?: string;
}

export interface TitleHandlers {
  file(action: 'open' | 'save'): void;
  edit(): void;
  claude(op: 'connect' | 'disconnect'): void;
  stage(st: Stage): void;
  find(): void;
  follow(): void;
}

/** 진행 띠의 단계 — [키, 이름, 짧은 이름] (템플릿 · 구성안 3.3 과 같은 차례) */
export const STEPS: Array<[Stage, string, string]> = [
  ['sec', '단면', '단면'], ['fsm', '좌굴 해석', '좌굴'], ['load', '하중 해석', '하중'],
  ['chk', '부재 검토', '검토'], ['conn', '접합부', '접합'], ['val', '점검', '점검'],
];
const STIP: Record<string, string> = {
  ok: '입력과 일치', stale: '낡음 — 입력이 바뀐 뒤 다시 돌리지 않음', none: '아직 안 함', run: '실행 중', unk: '결과 있음 · 최신 여부 모름',
};

export function pipeHtml(small = false): string {
  return `<span class="pipe${small ? ' sm' : ''}">${STEPS.map(([k, name, short], i) => {
    const s = state.stages[k];
    return `${i && !small ? '<b>→</b>' : ''}<a class="ps ${s.state}" data-stage="${k}" data-state="${s.state}"${tip(`${name} · ${STIP[s.state]}${s.note ? ` · ${s.note}` : ''}`)}>`
      + `<i></i>${small ? '' : `<em class="lg">${name}</em><em class="sh">${short}</em>`}</a>`;
  }).join('')}</span>`;
}

let root: HTMLElement;
let h: TitleHandlers;
let claudeBusy = false;
let claude: ClaudeStatus | null = null;

export function initTitlebar(el: HTMLElement, handlers: TitleHandlers): void {
  root = el;
  h = handlers;
  el.innerHTML = '<span class="logo">StCFSD</span>'
    + `<button class="pick" data-act="file"${tip('검토 대상 하나 = .csd 파일 하나(단면 + 부재 조건 + 하중 + 검토). 열기 · 저장')}>검토 대상 <b class="fname"></b> ▾</button>`
    + '<span class="ebadge" hidden data-tip="입력 화면이 열려 있다. 트리와 제목 줄은 그대로다">편집</span>'
    + '<span class="pipe-slot"></span>'
    + '<span class="sp"></span>'
    + `<button class="tb" data-act="find"${tip('검토 항목 · 구간 · 절점 · 요소 · 값을 이름이나 id 로 찾기  Ctrl+F')}>찾기</button>`
    + `<button class="tb follow" data-act="follow" aria-pressed="false"${tip('켜 두면 AI 가 「여기를 보세요」(focus) 할 때 화면이 그리로 간다 — 5 초 넘게 가만히 있고 편집 상태가 아닐 때만. 꺼져 있으면 움직이지 않고 「AI 가 가리킴」 알림만 남긴다. 창을 앞으로 가져오지 않는다')}>AI 따라가기</button>`
    + `<button class="tb" data-act="edit"${tip('지금의 입력 화면(6탭)을 연다. 다시 누르면 닫힌다  F2')}>편집 F2</button>`
    + '<span class="conn"><span class="dot un"></span><span class="ct">Claude 연결 확인 중</span></span>'
    + '<button class="cbtn claude-act" data-act="claude" hidden></button>';
  el.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const ps = t.closest('[data-stage]');
    if (ps) { h.stage(ps.getAttribute('data-stage') as Stage); return; }
    const b = t.closest('[data-act]') as HTMLElement | null;
    if (!b) { return; }
    const r = b.getBoundingClientRect();
    switch (b.getAttribute('data-act')) {
      case 'file':
        openMenu([{ label: '열기', kbd: 'Ctrl+O', run: () => h.file('open') }, { label: '저장', kbd: 'Ctrl+S', run: () => h.file('save') }],
          r.left, r.bottom + 2, '검토 대상');
        break;
      case 'edit': h.edit(); break;
      case 'find': h.find(); break;
      case 'follow': h.follow(); break;
      case 'claude': {
        const op = b.getAttribute('data-op') as 'connect' | 'disconnect' | null;
        if (op && !claudeBusy) { claudeBusy = true; renderClaude(claude); h.claude(op); }
        break;
      }
      default:
    }
  });
}

export function claudeDone(s: ClaudeStatus | null): void { claudeBusy = false; renderClaude(s); }

/** AI 따라가기 단추 — 켬 · 끔과 「AI 가 가리킴」(따르지 않은 요청이 있으면 점) */
export function renderFollow(on: boolean, pointed: boolean): void {
  const b = root?.querySelector('[data-act="follow"]') as HTMLElement | null;
  if (!b) { return; }
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.innerHTML = `AI 따라가기${pointed ? ' <i class="ptd" data-tip="AI 가 가리킨 곳이 있다 — 아래 알림을 누르면 그리로"></i>' : ''}`;
}

export function renderTitle(editing: boolean, pending: boolean): void {
  if (!root) { return; }
  (root.querySelector('.fname') as HTMLElement).textContent = state.file.name ?? '파일 없음';
  root.querySelector('.pick')?.setAttribute('data-tip', state.file.path
    ? `${state.file.path} — 검토 대상 하나 = .csd 파일 하나. 열기 · 저장` : '아직 파일로 열거나 저장하지 않았다. 열기 · 저장');
  (root.querySelector('.pipe-slot') as HTMLElement).innerHTML = pipeHtml();
  (root.querySelector('.ebadge') as HTMLElement).hidden = !editing;
  root.classList.toggle('edit', editing);
  const ed = root.querySelector('[data-act="edit"]') as HTMLElement;
  ed.classList.toggle('on', editing);
  ed.classList.toggle('edit', editing);
  ed.setAttribute('aria-pressed', String(editing));
  ed.textContent = editing ? '편집 마치기 F2' : '편집 F2';
  const name = state.file.name;
  document.title = `${pending ? '● 응답 필요 — ' : ''}${name ? `${name}${editing ? ' · 편집' : ''} — ` : ''}StCFSD`;
}

/** S4 와 같은 상태 글 · 단추(`/api/claude/status`) */
export function renderClaude(s: ClaudeStatus | null): void {
  claude = s;
  if (!root) { return; }
  const c = root.querySelector('.conn') as HTMLElement;
  const dot = c.querySelector('.dot') as HTMLElement;
  const ct = c.querySelector('.ct') as HTMLElement;
  const b = root.querySelector('.claude-act') as HTMLElement;
  if (!s) { ct.textContent = 'Claude 상태 모름'; dot.className = 'dot un'; b.hidden = true; return; }
  ct.textContent = s.text;
  c.setAttribute('data-tip', s.tooltip || '대화는 Claude Desktop 에서 한다');
  c.setAttribute('data-ui', s.ui);
  dot.className = `dot ${s.ui === 'connected' ? 'ok' : ['restart-needed', 'registered-elsewhere', 'invalid-config'].includes(s.ui) ? 'warn' : s.ui === 'registered' ? 'acc' : 'un'}`;
  if (s.canDisconnect) {
    b.hidden = false; b.textContent = '끊기'; b.setAttribute('data-op', 'disconnect');
    b.setAttribute('data-tip', 'Claude Desktop 설정에서 이 프로그램의 항목만 지운다');
  } else if (s.canConnect || s.ui === 'not-installed' || s.ui === 'invalid-config') {
    b.hidden = false; b.textContent = '연결'; b.setAttribute('data-op', s.canConnect ? 'connect' : '');
    b.setAttribute('data-tip', s.canConnect ? 'Claude Desktop 설정에 이 프로그램을 등록한다(다른 항목은 그대로, 쓰기 전에 백업)' : (s.tooltip || ''));
  } else { b.hidden = true; }
  b.classList.toggle('off', claudeBusy || (b.getAttribute('data-op') === ''));
  (b as HTMLButtonElement).disabled = claudeBusy || b.getAttribute('data-op') === '';
}

export function claudeStatus(): ClaudeStatus | null { return claude; }
