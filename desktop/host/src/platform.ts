/**
 * 화면·OS 에 묻는 일의 접점.
 *
 * 대체 모듈(`vscode/`)은 알림, 고르기, 입력, 열기 · 저장 대화상자, 진행 표시, 외부 주소 열기를
 * 모두 이 인터페이스로 넘긴다. 호스트가 사용자나 OS 에 무엇을 묻는 길은 이것 하나뿐이다.
 * S1 의 구현은 headless 다 — 기록만 남기고, 물음에는 정해 둔 답(CLI 인자 · 시험) 또는
 * undefined(취소)를 곧바로 돌려준다. 막히는 일이 없다. S2 의 다리 구현과 S3 의 Electron 구현이
 * 같은 인터페이스를 채운다.
 *
 * `withScriptedAnswers()` 는 아무 구현이나 감싸 "다음 대화상자의 답"을 미리 넣을 수 있게 한다.
 * 적재기의 `openProject` · `saveProject` 가 이것으로 확장의 열기 · 저장 대화상자 길을 그대로 탄다.
 */

export type NotifySeverity = 'info' | 'warning' | 'error';

export interface NotifyRequest {
  severity: NotifySeverity;
  message: string;
  /** 단추 제목. 비어 있으면 단순 알림이다. */
  items: string[];
  modal: boolean;
  detail?: string;
}

export interface PickItem {
  label: string;
  description?: string;
  detail?: string;
  picked?: boolean;
}

export interface PickRequest {
  items: PickItem[];
  canPickMany: boolean;
  title?: string;
  placeHolder?: string;
}

export interface InputRequest {
  title?: string;
  prompt?: string;
  value?: string;
  placeHolder?: string;
  password?: boolean;
}

export interface FileDialogRequest {
  kind: 'open' | 'save';
  title?: string;
  /** 절대 경로 */
  defaultPath?: string;
  filters?: Record<string, string[]>;
  canSelectFiles?: boolean;
  canSelectFolders?: boolean;
  canSelectMany?: boolean;
  openLabel?: string;
  saveLabel?: string;
}

export interface ProgressState {
  id: number;
  title?: string;
  message?: string;
  /** 누적 증가분(VS Code 의 increment 합) */
  percent?: number;
  done: boolean;
  cancellable: boolean;
}

/** 받은 물음 한 건(기록용). */
export interface PlatformQuestion {
  kind: 'notify' | 'pick' | 'input' | 'openDialog' | 'saveDialog';
  summary: string;
  answer: unknown;
}

export interface HostPlatform {
  /** 알림. 단추가 있으면 고른 단추 제목을, 닫으면 undefined 를 돌려준다. */
  notify(req: NotifyRequest): Promise<string | undefined>;
  /** 고르기. 고른 항목의 번호(여럿이면 번호 배열), 취소면 undefined. */
  pick(req: PickRequest): Promise<number | number[] | undefined>;
  input(req: InputRequest): Promise<string | undefined>;
  /** 열기/저장 대화상자. 고른 절대 경로들, 취소면 undefined. */
  fileDialog(req: FileDialogRequest): Promise<string[] | undefined>;
  /** 외부 주소(브라우저). 열었으면 true */
  openExternal(target: string): Promise<boolean>;
  progress(state: ProgressState): void;
  /** 화면에 보이라는 요청(패널 reveal · 트리 reveal). headless 는 기록만 한다. */
  reveal(target: string): void;
}

export interface HeadlessPlatformOptions {
  /** 알림 단추 답. 없으면 undefined(닫음). */
  notifyAnswers?: (req: NotifyRequest) => string | undefined;
  pickAnswers?: (req: PickRequest) => number | number[] | undefined;
  inputAnswers?: (req: InputRequest) => string | undefined;
  /** 대화상자 답. 없으면 취소 */
  dialogAnswers?: (req: FileDialogRequest) => string[] | undefined;
  /** 로그를 찍을 곳. 기본은 stderr. 조용히 하려면 () => {} */
  log?: (line: string) => void;
}

export interface HeadlessPlatform extends HostPlatform {
  readonly questions: PlatformQuestion[];
  readonly notifications: NotifyRequest[];
  readonly externals: string[];
  readonly reveals: string[];
}

const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function createHeadlessPlatform(options: HeadlessPlatformOptions = {}): HeadlessPlatform {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const questions: PlatformQuestion[] = [];
  const notifications: NotifyRequest[] = [];
  const externals: string[] = [];
  const reveals: string[] = [];

  return {
    questions, notifications, externals, reveals,
    async notify(req) {
      notifications.push(req);
      if (notifications.length > 500) { notifications.splice(0, notifications.length - 500); }
      const answer = req.items.length > 0 ? options.notifyAnswers?.(req) : undefined;
      log(`[headless] 알림(${req.severity}${req.modal ? ', modal' : ''}): ${short(req.message)}`
        + (req.items.length ? ` [${req.items.join(' | ')}] → ${answer ?? '(닫음)'}` : ''));
      if (req.items.length > 0 || req.modal) {
        questions.push({ kind: 'notify', summary: `${req.severity}: ${short(req.message, 120)}`
          + (req.items.length ? ` [${req.items.join(' | ')}]` : ''), answer });
      }
      return answer;
    },
    async pick(req) {
      const answer = options.pickAnswers?.(req);
      const summary = `${req.title ?? req.placeHolder ?? '(제목 없음)'} — ${req.items.length}개`;
      questions.push({ kind: 'pick', summary, answer });
      log(`[headless] 고르기: ${summary} → ${answer === undefined ? '(취소)' : JSON.stringify(answer)}`);
      return answer;
    },
    async input(req) {
      const answer = options.inputAnswers?.(req);
      const summary = `${req.title ?? ''} ${req.prompt ?? ''}`.trim() || '(제목 없음)';
      questions.push({ kind: 'input', summary, answer });
      log(`[headless] 입력: ${summary} → ${answer ?? '(취소)'}`);
      return answer;
    },
    async fileDialog(req) {
      const answer = options.dialogAnswers?.(req);
      const summary = dialogSummary(req);
      questions.push({ kind: req.kind === 'open' ? 'openDialog' : 'saveDialog', summary, answer });
      log(`[headless] ${req.kind === 'open' ? '열기' : '저장'} 대화상자: ${summary} → ${answer ? answer.join(', ') : '(취소)'}`);
      return answer;
    },
    async openExternal(target) {
      externals.push(target);
      log(`[headless] 외부 열기(하지 않음): ${target}`);
      return false;
    },
    progress(state) {
      if (state.done) { log(`[headless] 진행 끝: ${state.title ?? state.id}`); }
    },
    reveal(target) {
      reveals.push(target);
      if (reveals.length > 200) { reveals.shift(); }
    },
  };
}

function dialogSummary(req: FileDialogRequest): string {
  const filters = req.filters ? Object.values(req.filters).flat().join(',') : '-';
  return `${req.title ?? req.openLabel ?? req.saveLabel ?? ''} [${filters}] default=${req.defaultPath ?? '-'}`;
}

/** 미리 넣은 대화상자 답 한 건 */
export interface ScriptedDialog {
  kind: 'open' | 'save';
  paths: string[];
}

export interface ScriptedPlatform {
  /** 감싼 플랫폼 — 대체 모듈에 이것을 준다 */
  platform: HostPlatform;
  /** 다음 `kind` 대화상자의 답을 넣는다. 그 대화상자가 오면 아래 플랫폼에 묻지 않고 이 답을 쓴다 */
  queueDialog(answer: ScriptedDialog): void;
  /** 아직 쓰이지 않은 답을 버린다 */
  clearDialogs(): void;
  /** 대화상자 · 알림을 바깥에서 본다(적재기가 열기 · 저장이 끝났는지 안다) */
  onDialog?: (req: FileDialogRequest, answer: string[] | undefined, scripted: boolean) => void;
  onNotify?: (req: NotifyRequest) => void;
}

/**
 * 아무 HostPlatform 이나 감싼다. 미리 넣은 대화상자 답이 있으면 그것을 쓰고(기록은 남는다),
 * 없으면 아래 구현에 그대로 묻는다. 모든 알림 · 대화상자는 여전히 이 한 길로 지나간다.
 */
export function withScriptedAnswers(inner: HostPlatform, log: (line: string) => void): ScriptedPlatform {
  const queue: ScriptedDialog[] = [];
  const self: ScriptedPlatform = {
    queueDialog(answer) { queue.push(answer); },
    clearDialogs() { queue.length = 0; },
    platform: {
      async notify(req) {
        const answer = await inner.notify(req);
        self.onNotify?.(req);
        return answer;
      },
      pick: req => inner.pick(req),
      input: req => inner.input(req),
      async fileDialog(req) {
        const i = queue.findIndex(q => q.kind === req.kind);
        if (i >= 0) {
          const [scripted] = queue.splice(i, 1);
          log(`[host] ${req.kind === 'open' ? '열기' : '저장'} 대화상자에 정해 둔 답: ${scripted.paths.join(', ')} (${dialogSummary(req)})`);
          // 아래 구현의 기록에도 남긴다(headless 의 questions) — 답은 이미 정해졌다.
          const recorder = inner as Partial<HeadlessPlatform>;
          recorder.questions?.push({ kind: req.kind === 'open' ? 'openDialog' : 'saveDialog',
            summary: `${dialogSummary(req)} (정해 둔 답)`, answer: scripted.paths });
          self.onDialog?.(req, scripted.paths, true);
          return scripted.paths;
        }
        const answer = await inner.fileDialog(req);
        self.onDialog?.(req, answer, false);
        return answer;
      },
      openExternal: target => inner.openExternal(target),
      progress: state => inner.progress(state),
      reveal: target => inner.reveal(target),
    },
  };
  return self;
}
