/**
 * 화면 다리용 HostPlatform — 호스트의 물음(단추 있는 알림 · modal 확인 · 고르기 · 입력 · 열기/저장 대화상자)을
 * 이벤트 `platform:question` 으로 화면에 넘기고, 화면이 `POST /api/platform/answer {qid, answer}` 로 답한다.
 * (StAnal `bridge/platform.ts` 를 옮겨 StCFSD 의 HostPlatform 에 맞춤)
 *
 * - 화면(틀 `/` 의 이벤트 흐름)이 하나도 붙어 있지 않으면 headless 와 같다(답 없음 = 취소).
 * - 물음을 낸 뒤 화면이 모두 떨어지면 기다리던 물음은 취소로 끝난다. VS Code 의 대화상자도 시간 제한이 없다 —
 *   시간 제한을 두지 않는다.
 * - 단순 알림 · 진행 · 보이기 · 외부 열기는 이벤트로만 흘린다(답이 필요 없다).
 * - 열기/저장 대화상자: 물음에 `suggestedPath` 를 붙인다 — 사용자 문서 폴더 아래 `StCFSD\`(+ 저장이면 파일 이름).
 *   다리는 그 폴더를 **읽지도 만들지도 않는다**. 사용자가 경로를 확인해 답하면 그때 호스트가 그 파일을 읽거나 쓴다
 *   (저장이면 다리가 그 부모 폴더를 만든다 — 확인한 경로에 대해서만).
 * - S3(Electron)는 `fileDialog` 를 OS 대화상자로 바꿔 끼운다(`BridgePlatformOptions.fileDialog`) — 같은 인터페이스다.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createHeadlessPlatform, type FileDialogRequest, type HeadlessPlatform, type HostPlatform,
  type InputRequest, type NotifyRequest, type PickRequest, type ProgressState,
} from '../platform';

export type QuestionKind = 'notify' | 'pick' | 'input' | 'fileDialog';

export interface PendingQuestion {
  qid: string;
  kind: QuestionKind;
  request: NotifyRequest | PickRequest | InputRequest | (FileDialogRequest & { suggestedPath?: string });
  at: number;
}

/** 다리가 채우는 접점 */
export interface PlatformSink {
  /** 물음을 받을 화면이 붙어 있는가 */
  hasClient(): boolean;
  emit(type: string, payload: unknown): void;
}

export interface BridgePlatform extends HostPlatform {
  /** 기록 · 화면이 없을 때의 답 */
  readonly headless: HeadlessPlatform;
  attach(sink: PlatformSink): () => void;
  pending(): PendingQuestion[];
  /** 답을 넣는다. 형식이 틀리면 오류 문자열, 맞으면 undefined. null = 취소 */
  answer(qid: string, answer: unknown): string | undefined;
  /** 기다리는 물음을 모두 취소로 끝낸다(화면이 모두 떨어졌을 때) */
  cancelAll(reason: string): void;
  /** 새로 붙은 화면이 처음 그릴 것 */
  snapshot(): { progress: ProgressState[]; pending: PendingQuestion[] };
  /** 대화상자에 답이 났다(화면이든 S3 의 OS 대화상자든) — 다리가 지금 파일 이름을 따라간다 */
  onDialogAnswered?: (req: FileDialogRequest, paths: string[] | undefined) => void;
  /** 호스트가 알림을 냈다 */
  onNotify?: (req: NotifyRequest) => void;
  /** R3-3: 원자료 파일 하나를 OS 의 기본 앱으로(껍데기만 — 없으면 false). 경로는 이 프로세스 안에서만 */
  openPath(abs: string): Promise<boolean>;
}

export interface BridgePlatformOptions {
  log?: (line: string) => void;
  /** 대화상자의 기본 폴더의 부모(기본: `<홈>/Documents`). 시험은 임시 폴더를 준다 */
  documentsDir?: string;
  /** S3: OS 대화상자. 주면 열기/저장은 화면에 묻지 않고 이것을 쓴다 */
  fileDialog?: (req: FileDialogRequest & { suggestedPath: string }) => Promise<string[] | undefined>;
  /** S3: 외부 주소를 OS 브라우저로 연다(http/https 만 — 껍데기가 거른다). 없으면 기록만 */
  openExternal?: (target: string) => Promise<boolean>;
  /** R3-3: 프로젝트의 원자료 파일 하나를 OS 의 기본 앱으로 연다(껍데기 — shell.openPath). 없으면 열지 않고 알리기만(헤드리스 · 시험) */
  openPath?: (abs: string) => Promise<boolean>;
  /**
   * S3: 화면이 아직 안 붙었을 때(시작 중)의 단추 있는 알림 · modal 알림을 OS 대화상자로 묻는다.
   * 없으면 headless 처럼 곧바로 닫음(답 없음)이다.
   */
  notifyWithoutScreen?: (req: NotifyRequest) => Promise<string | undefined>;
}

/** 사용자 문서 폴더(Windows 의 OneDrive 로 옮긴 문서 폴더는 S3 가 Electron `app.getPath('documents')` 로 준다) */
export function defaultDocumentsDir(): string {
  return path.join(os.homedir(), 'Documents');
}

export function createBridgePlatform(options: BridgePlatformOptions = {}): BridgePlatform {
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const headless = createHeadlessPlatform({ log });
  const workDir = path.join(options.documentsDir ?? defaultDocumentsDir(), 'StCFSD');
  let sink: PlatformSink | undefined;
  let seq = 0;
  const waiting = new Map<string, { q: PendingQuestion; resolve: (v: unknown) => void; validate: (v: unknown) => string | undefined }>();
  const progress = new Map<number, ProgressState>();

  function ask<T>(kind: QuestionKind, request: PendingQuestion['request'], validate: (v: unknown) => string | undefined,
    fallback: () => Promise<T>): Promise<T> {
    if (!sink || !sink.hasClient()) { return fallback(); }
    seq += 1;
    const q: PendingQuestion = { qid: `q${seq}`, kind, request, at: Date.now() };
    return new Promise<T>(resolve => {
      waiting.set(q.qid, { q, resolve: resolve as (v: unknown) => void, validate });
      sink!.emit('platform:question', q);
    });
  }

  const isStr = (v: unknown) => typeof v === 'string';

  /** 저장이면 기본 이름(defaultPath 의 이름 → 거르개의 첫 확장자), 열기면 폴더 */
  const suggest = (req: FileDialogRequest): string => {
    if (req.kind === 'open') { return workDir + path.sep; }
    const base = req.defaultPath ? path.basename(req.defaultPath) : '';
    const ext = req.filters ? Object.values(req.filters)[0]?.[0] : undefined;
    return path.join(workDir, base || `project${ext ? `.${ext}` : ''}`);
  };

  const platform: BridgePlatform = {
    headless,
    attach(s) {
      sink = s;
      return () => { if (sink === s) { sink = undefined; platform.cancelAll('다리가 닫혔다'); } };
    },
    pending: () => [...waiting.values()].map(w => w.q),
    answer(qid, answer) {
      const w = waiting.get(qid);
      if (!w) { return `그런 물음이 없다(이미 답했거나 취소됐다): ${qid}`; }
      if (answer !== undefined && answer !== null) {
        const problem = w.validate(answer);
        if (problem) { return problem; }
      }
      waiting.delete(qid);
      const value = answer === null ? undefined : answer;
      const isFile = w.q.kind === 'fileDialog';
      const freq = w.q.request as FileDialogRequest;
      if (isFile && freq.kind === 'save' && Array.isArray(value) && value[0]) {
        // 확인한 저장 경로의 폴더만 만든다(호스트는 `<파일>.tmp` 를 쓰고 이름을 바꾼다 — 폴더가 있어야 한다).
        try { fs.mkdirSync(path.dirname(value[0] as string), { recursive: true }); } catch (err) {
          log(`[bridge] 저장 폴더를 만들지 못했다: ${String(err)}`);
        }
      }
      headless.questions.push({ kind: isFile ? (freq.kind === 'open' ? 'openDialog' : 'saveDialog') : w.q.kind as 'notify' | 'pick' | 'input',
        summary: `(화면) ${summaryOf(w.q)}`, answer: value });
      sink?.emit('platform:answered', { qid, answer: value });
      if (isFile) { platform.onDialogAnswered?.(freq, value as string[] | undefined); }
      w.resolve(value);
      return undefined;
    },
    cancelAll(reason) {
      for (const [qid, w] of [...waiting]) {
        waiting.delete(qid);
        log(`[bridge] 물음 취소(${reason}): ${summaryOf(w.q)}`);
        sink?.emit('platform:answered', { qid, answer: undefined, cancelled: reason });
        w.resolve(undefined);
      }
    },
    snapshot: () => ({ progress: [...progress.values()], pending: platform.pending() }),

    async notify(req) {
      if (req.items.length === 0 && !req.modal) {
        sink?.emit('platform:notify', req);
        const r = await headless.notify(req);
        platform.onNotify?.(req);
        return r;
      }
      headless.notifications.push(req);
      const r = await ask<string | undefined>('notify', req,
        v => (isStr(v) && req.items.includes(v as string) ? undefined : `단추 제목 중 하나여야 한다: ${req.items.join(' | ')}`),
        () => {
          if (options.notifyWithoutScreen) { return options.notifyWithoutScreen(req); }
          headless.notifications.pop();
          return headless.notify(req);
        });
      platform.onNotify?.(req);
      return r;
    },
    pick(req) {
      return ask<number | number[] | undefined>('pick', req, v => {
        const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < req.items.length;
        if (req.canPickMany) { return Array.isArray(v) && v.every(ok) ? undefined : '번호 배열이어야 한다'; }
        return ok(v) ? undefined : `0 – ${req.items.length - 1} 의 번호여야 한다`;
      }, () => headless.pick(req));
    },
    input(req) {
      return ask<string | undefined>('input', req, v => (isStr(v) ? undefined : '문자열이어야 한다'), () => headless.input(req));
    },
    async fileDialog(req) {
      const suggestedPath = suggest(req);
      if (options.fileDialog) {
        const r = await options.fileDialog({ ...req, suggestedPath });
        platform.onDialogAnswered?.(req, r);
        return r;
      }
      return ask<string[] | undefined>('fileDialog', { ...req, suggestedPath }, v => {
        if (!Array.isArray(v) || v.length === 0 || !v.every(p => isStr(p) && path.isAbsolute(p as string))) {
          return '절대 경로 배열이어야 한다';
        }
        if (req.kind === 'save' && v.length !== 1) { return '저장 대화상자는 경로 하나'; }
        if (req.kind === 'open' && !req.canSelectMany && v.length !== 1) { return '경로 하나'; }
        if (req.kind === 'open' && !v.every(p => { try { return fs.statSync(p as string).isFile(); } catch { return false; } })) {
          return '그런 파일이 없다';
        }
        return undefined;
      }, () => headless.fileDialog(req));
    },
    openExternal(target) {
      sink?.emit('platform:openExternal', { target });
      return options.openExternal ? options.openExternal(target) : headless.openExternal(target);
    },
    openPath(abs: string) {
      // 경로는 이 프로세스 안에서만(화면 · 이벤트에는 파일 이름만)
      sink?.emit('platform:openPath', { name: abs.split(/[\\/]/).pop() ?? '' });
      return options.openPath ? options.openPath(abs) : Promise.resolve(false);
    },
    progress(state) {
      if (state.done) { progress.delete(state.id); } else { progress.set(state.id, state); }
      sink?.emit('platform:progress', state);
      headless.progress(state);
    },
    reveal(target) { sink?.emit('platform:reveal', { target }); headless.reveal(target); },
  };
  return platform;
}

function summaryOf(q: PendingQuestion): string {
  const r = q.request as unknown as Record<string, unknown>;
  return `${q.kind} ${String(r.title ?? r.message ?? r.prompt ?? r.placeHolder ?? r.saveLabel ?? r.openLabel ?? '')}`.slice(0, 120);
}
