/**
 * 저장 안 한 변경 — 검토 대상을 바꾸는 모든 길(창 닫기 · 메뉴 「열기」 · 끼운 화면의 Open 단추 · Ctrl+O · 시작 화면 · 제목 표시줄 ·
 * 다시 실행 · 파일 연결)이 지나는 **하나의 함수**(V5-12c · V7-41). 다리(브라우저 · 창의 페이지 Open)와 창(껍데기)이 같이 쓴다.
 *
 *  1. 끼운 화면에 밀린 입력을 먼저 호스트로(V7-44 — 닫기 직전 300 ms 안에 친 글자가 사라지지 않게) — `flush`
 *  2. 호스트 `get_unsaved_changes` 를 묻는다. 읽지 못하면(오류 · 답 없음) **묻는다** — 「확인할 수 없다」고 말하고(V7-46, fail closed)
 *  3. 더러울 때만 「저장 · 저장 안 함 · 취소」. 깨끗하면 묻지 않는다
 *  4. 「저장」(V7-42): 이번 세션에 **사람이 스스로**(대화상자 · 자기 손의 열기) 정한 `.csd` 이고 이 프로그램이 쓴 `.csd` 일 때만 묻지 않고
 *     그 파일에 쓴다. 그 밖(AI 의 load_project 가 정한 경로 · 다른 확장자 · 남의 파일)은 저장 자리를 묻는다. `.csd` 가 아닌 파일 ·
 *     이 프로그램이 쓰지 않은 파일 위에는 쓰지 않는다
 *  5. 물음이 떠 있는 동안 다시 부르면(✕ 를 또 누름) 같은 물음의 답을 기다린다(둘째 물음을 띄우지 않고 지나치지도 않는다 — V7-46)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export type UnsavedWhere = 'close' | 'open' | 'page-open' | 'second-instance' | 'file-association';
export type UnsavedAnswer = 'save' | 'discard' | 'cancel';
export interface UnsavedResult { proceed: boolean; how: 'none' | 'asked'; answer: UnsavedAnswer | 'proceed'; failed?: boolean; saved?: string; note?: string; joined?: boolean }

export interface UnsavedCtx {
  /** 호스트 동작(MCP 다리의 /action — AI 호출로 세지 않는다). 실패면 undefined 또는 {error} */
  hostAction(action: string, params?: Record<string, unknown>): Promise<any>;
  /** 사람에게 묻는다 — 창 닫기는 OS 대화상자, 그 밖은 화면 안의 물음(부르는 쪽이 정한다) */
  ask(where: UnsavedWhere, q: { message: string; detail: string; items: string[] }): Promise<UnsavedAnswer>;
  /** 이번 세션에 사람이 스스로 정한 지금 파일(대화상자 · 자기 손의 열기 · 저장). 없으면 undefined */
  personFile(): string | undefined;
  /** 호스트가 쥔 지금 파일의 경로(panel.caseFile() — 같은 프로세스의 사람 얼굴). 없으면 get_unsaved_changes.file 을 쓴다 */
  caseFile?(): string | null;
  /** 저장 자리를 묻는다(사람이 「저장」을 고른 뒤). 취소면 undefined */
  askSavePath(defaultName: string): Promise<string | undefined>;
  /** 호스트의 저장 길로 그 파일에 쓴다 */
  saveProject(file: string): Promise<{ ok: boolean; file?: string; message?: string }>;
  /** 끼운 화면의 밀린 입력을 호스트로(있으면) — 오래 걸리면 기다리지 않는다 */
  flush?(): Promise<void>;
  log?(line: string): void;
}

export const UNSAVED_ITEMS = ['저장', '저장 안 함', '취소'];
const WHERE_KO: Record<UnsavedWhere, string> = {
  close: '창을 닫기 전에', open: '다른 파일을 열기 전에', 'page-open': '다른 파일을 열기 전에',
  'second-instance': '넘어온 파일을 열기 전에', 'file-association': '연결된 파일을 열기 전에',
};

/** 이 프로그램이 쓴 `.csd` 인가(JSON 이고 version · model 이 있다). 없는 파일은 true(새로 쓴다) */
export function isOurCsd(file: string): boolean {
  if (!/\.csd$/i.test(file)) { return false; }
  let st: fs.Stats;
  try { st = fs.lstatSync(file); } catch { return true; }
  if (!st.isFile() || st.isSymbolicLink()) { return false; }
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return !!j && typeof j === 'object' && typeof j.version === 'string' && typeof j.model === 'object';
  } catch { return false; }
}

/** 떠 있는 물음(프로세스에 검토 대상은 하나 — 다리와 창이 같은 모듈을 쓴다) */
let inflight: Promise<UnsavedResult> | null = null;

/** 하나의 함수 — 계속해도 되는가(저장했거나 · 버렸거나 · 바뀐 것이 없다). 물음이 떠 있으면 그 답을 같이 기다린다 */
export function confirmUnsaved(ctx: UnsavedCtx, where: UnsavedWhere): Promise<UnsavedResult> {
  if (inflight) { return inflight.then(r => ({ ...r, joined: true })); }
  const p = run(ctx, where).finally(() => { if (inflight === p) { inflight = null; } });
  inflight = p;
  return p;
}

async function run(ctx: UnsavedCtx, where: UnsavedWhere): Promise<UnsavedResult> {
  if (ctx.flush) { await Promise.race([ctx.flush().catch(() => undefined), new Promise(r => setTimeout(r, 1500))]); }
  let u: any;
  try { u = await ctx.hostAction('get_unsaved_changes'); } catch (err) { u = { error: String(err) }; }
  const failed = !u || typeof u !== 'object' || !!u.error || typeof u.dirty !== 'boolean';
  if (!failed && !u.dirty) { return { proceed: true, how: 'none', answer: 'proceed' }; }
  let message: string;
  let detail: string;
  if (failed) {
    message = `저장하지 않은 변경이 있는지 확인할 수 없습니다 — ${WHERE_KO[where]} 저장할까요?`;
    detail = `호스트의 상태를 읽지 못했습니다${u?.error ? ` (${String(u.error).slice(0, 160)})` : ''}. 「저장 안 함」을 고르면 바뀐 것이 사라질 수 있습니다.`;
  } else {
    const nIn = Array.isArray(u.inputs_changed) ? u.inputs_changed.length : 0;
    const what = [nIn ? `검토 입력 ${nIn}칸` : '', u.model_changed ? '모델' : ''].filter(Boolean).join(' · ') || '입력';
    message = `저장하지 않은 변경(${what})이 있습니다 — ${WHERE_KO[where]} 저장할까요?`;
    detail = fileOf(ctx, u) ? `파일: ${fileOf(ctx, u)}` : '아직 파일로 저장한 적이 없습니다.';
  }
  const answer = await ctx.ask(where, { message, detail, items: UNSAVED_ITEMS });
  ctx.log?.(`저장 안 한 변경 — ${where}: ${answer}${failed ? ' (상태를 읽지 못함)' : ''}`);
  if (answer === 'cancel') { return { proceed: false, how: 'asked', answer, failed }; }
  if (answer === 'discard') { return { proceed: true, how: 'asked', answer, failed }; }
  const s = await saveSafely(ctx, failed ? null : fileOf(ctx, u), failed ? null : (u.file_origin ?? undefined));
  return { proceed: s.ok, how: 'asked', answer, failed, saved: s.file, note: s.note };
}

/**
 * 지금 파일의 경로 — 호스트가 같은 프로세스에 주는 사람의 얼굴(panel.caseFile())이 먼저. 호스트의 답(get_unsaved_changes.file)은 그것이 없을 때만
 * (V9b-06 · D1: 호스트는 AI 가 읽는 상태 답에 프로젝트 안의 경로를 싣지 않는다 — 화면 · 다리는 답에서 경로를 읽지 않는다)
 */
function fileOf(ctx: UnsavedCtx, u: any): string | null {
  let f: string | null = null;
  try { f = ctx.caseFile?.() ?? null; } catch { f = null; }
  if (f) { return f; }
  return typeof u?.file === 'string' && u.file ? u.file : null;
}

/** 「저장」의 자리 — 사람이 정한 그 `.csd`(이 프로그램이 쓴 것)만 묻지 않고, 그 밖은 묻는다 */
export async function saveSafely(ctx: UnsavedCtx, hostFile: string | null, fileOrigin?: string | null): Promise<{ ok: boolean; file?: string; note?: string }> {
  const mine = ctx.personFile();
  const same = (a?: string | null, b?: string | null) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  // 호스트가 말하는 지금 파일의 출처(4b99968 — get_unsaved_changes.file_origin: person · ai)가 근거. 화면이 적은 「사람이 정한 파일」은
  // 맞대어 보는 것 — 둘이 다르면(또는 호스트가 출처를 말하지 않으면 화면의 기록만으로) 묻는다
  const byHost = fileOrigin === undefined ? same(hostFile, mine) : fileOrigin === 'person' && same(hostFile, mine);
  let target: string | undefined;
  if (hostFile && byHost && isOurCsd(hostFile)) {
    target = hostFile;
  } else {
    const base = hostFile ? path.basename(hostFile).replace(/\.[^.]*$/, '') : 'project';
    target = await ctx.askSavePath(`${base}.csd`);
    if (!target) { return { ok: false, note: '저장 자리를 고르지 않았다' }; }
    if (!/\.csd$/i.test(target)) { target = `${target}.csd`; }
    if (!isOurCsd(target)) {
      ctx.log?.(`저장하지 않음 — ${target} 은(는) 이 프로그램이 쓴 .csd 가 아니다`);
      return { ok: false, note: `${path.basename(target)} 은(는) 이 프로그램이 쓴 .csd 가 아니라 덮어쓰지 않았다` };
    }
  }
  const r = await ctx.saveProject(target);
  if (!r.ok) { ctx.log?.(`저장 실패 — ${r.message ?? ''}`); return { ok: false, note: r.message }; }
  return { ok: true, file: r.file ?? target };
}
