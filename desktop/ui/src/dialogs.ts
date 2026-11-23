/**
 * 호스트의 물음(platform:question) — 단추 있는 알림 · 고르기 · 입력 · 열기/저장을 화면 가운데 상자로, 한 번에 하나씩.
 * 틀(`host/frame/frame.js`)과 같은 모양 · 같은 답(`POST /api/platform/answer`). 열기/저장은 경로 칸 하나(브라우저) —
 * Electron 창에서는 다리가 OS 대화상자로 바꾸므로 이 칸이 뜨지 않는다.
 * 그 밖: 잠깐 뜨는 알림(platform:notify) · 진행(platform:progress)은 상태 표시줄 오른쪽.
 */
import { api } from './bridge';
import { bidiSafe, esc } from './dom';

export interface Question { qid: string; kind: 'notify' | 'pick' | 'input' | 'fileDialog'; request: any; at: number }

let current: Question | null = null;
let queue: Question[] = [];
let onChange: () => void = () => undefined;

export function initDialogs(changed: () => void): void { onChange = changed; }
export function questionOpen(): boolean { return !!current; }

export function enqueue(q: Question): void {
  if (current?.qid === q.qid || queue.some(x => x.qid === q.qid)) { return; }
  queue.push(q);
  if (!current) { next(); }
}

export function answered(qid: string): void {
  queue = queue.filter(x => x.qid !== qid);
  if (current?.qid === qid) {
    current = null;
    const host = document.getElementById('dialog-host')!;
    host.innerHTML = '';
    host.classList.remove('open');
    next();
  }
  onChange();
}

function next(): void {
  if (current || !queue.length) { return; }
  current = queue.shift()!;
  render(current);
  onChange();
}

function answer(q: Question, value: unknown, err: HTMLElement): void {
  void api('POST', '/api/platform/answer', { qid: q.qid, answer: value }).then(r => {
    if (r.success) { answered(q.qid); } else { err.textContent = r.error ?? '답을 받지 않았다'; }
  });
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'class') { e.className = v; } else { e.setAttribute(k, v); } }
  if (text !== undefined) { e.textContent = bidiSafe(text); }
  return e;
}

function render(q: Question): void {
  const host = document.getElementById('dialog-host')!;
  host.innerHTML = '';
  const r = q.request ?? {};
  const d = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'data-kind': q.kind, 'data-qid': q.qid });
  const err = el('div', { class: 'error' });
  const buttons = el('div', { class: 'buttons' });
  const cancel = (label = '취소') => {
    const b = el('button', { type: 'button', class: 'btn ghost', 'data-role': 'cancel' }, label);
    b.addEventListener('click', () => answer(q, null, err));
    return b;
  };
  if (q.kind === 'notify') {
    d.appendChild(el('h2', {}, r.severity === 'error' ? '오류' : r.severity === 'warning' ? '확인' : '알림'));
    d.appendChild(el('p', { class: 'msg' }, String(r.message ?? '')));
    if (r.detail) { d.appendChild(el('pre', { class: 'detail' }, String(r.detail))); }
    (r.items ?? []).forEach((title: string, i: number) => {
      const b = el('button', { type: 'button', class: i === 0 ? 'btn primary' : 'btn', 'data-item': title }, title);
      b.addEventListener('click', () => answer(q, title, err));
      buttons.appendChild(b);
    });
    buttons.appendChild(cancel('닫기'));
  } else if (q.kind === 'pick') {
    d.appendChild(el('h2', {}, r.title || r.placeHolder || '고르기'));
    const items = el('div', { class: 'items' });
    const picked: number[] = [];
    (r.items ?? []).forEach((it: any, i: number) => {
      const b = el('button', { type: 'button', class: 'btn', 'data-index': String(i) });
      b.appendChild(document.createTextNode(String(it.label ?? '')));
      if (it.description) { b.appendChild(el('span', { class: 'desc' }, String(it.description))); }
      b.addEventListener('click', () => {
        if (!r.canPickMany) { answer(q, i, err); return; }
        const k = picked.indexOf(i);
        if (k >= 0) { picked.splice(k, 1); b.classList.remove('primary'); } else { picked.push(i); b.classList.add('primary'); }
      });
      items.appendChild(b);
    });
    d.appendChild(items);
    if (r.canPickMany) {
      const ok = el('button', { type: 'button', class: 'btn primary', 'data-role': 'ok' }, '확인');
      ok.addEventListener('click', () => answer(q, picked.slice().sort(), err));
      buttons.appendChild(ok);
    }
    buttons.appendChild(cancel());
  } else {
    const isFile = q.kind === 'fileDialog';
    d.appendChild(el('h2', {}, isFile ? (r.title || (r.kind === 'save' ? (r.saveLabel || '저장') : (r.openLabel || '열기'))) : (r.title || r.prompt || '입력')));
    const input = el('input', { type: !isFile && r.password ? 'password' : 'text', 'data-role': 'value', spellcheck: 'false' }) as HTMLInputElement;
    input.value = isFile ? (r.suggestedPath || '') : (r.value || '');
    d.appendChild(input);
    if (isFile && r.filters) {
      const exts = Object.keys(r.filters).map(k => `${k} (${(r.filters[k] as string[]).map(x => `.${x}`).join(', ')})`).join(' · ');
      input.setAttribute('data-tip', `${r.kind === 'save' ? '저장할' : '열'} 파일의 전체 경로. 확인을 누르기 전에는 읽거나 쓰지 않는다 · ${exts}`);
    }
    const ok = el('button', { type: 'button', class: 'btn primary', 'data-role': 'ok' }, isFile ? (r.kind === 'save' ? '저장' : '열기') : '확인');
    const submit = () => {
      const v = input.value.trim();
      if (isFile) { if (!v) { err.textContent = '경로가 비었다'; return; } answer(q, [v], err); } else { answer(q, input.value, err); }
    };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { submit(); } if (e.key === 'Escape') { answer(q, null, err); } });
    buttons.appendChild(ok);
    buttons.appendChild(cancel());
    setTimeout(() => { input.focus(); input.select(); }, 0);
  }
  d.appendChild(buttons);
  d.appendChild(err);
  host.appendChild(d);
  host.classList.add('open');
}

// ── 잠깐 뜨는 알림 · 진행 ─────────────────────────────────────────
/** 확장 전용 문구는 거른다(독립 프로그램에서는 뜻이 없다) */
const NOISE = /확장이 활성화|extension (is )?activated|VS ?Code|출력 패널|명령 팔레트/i;

export function toast(text: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!text || NOISE.test(text)) { return; }
  const host = document.querySelector('.status .toasts');
  if (!host) { return; }
  const ms = level === 'error' ? 12000 : 6000;
  const t = document.createElement('span');
  t.className = `toast ${level}`;
  t.textContent = bidiSafe(text.length > 140 ? `${text.slice(0, 140)}…` : text);
  if (text.length > 140) { t.setAttribute('data-tip', text); }
  host.appendChild(t);
  while (host.children.length > 2) { host.firstElementChild?.remove(); }
  setTimeout(() => t.remove(), ms);
}

const progress = new Map<string, any>();
export function setProgress(p: any): void {
  if (p.done) { progress.delete(String(p.id)); } else { progress.set(String(p.id), p); }
  const host = document.querySelector('.status .prog') as HTMLElement | null;
  if (!host) { return; }
  const live = [...progress.values()];
  const x = live[live.length - 1];
  host.innerHTML = x ? `<span class="pulse"></span>${esc(x.title || '진행 중')}${x.message ? ` — ${esc(x.message)}` : ''}` : '';
}
