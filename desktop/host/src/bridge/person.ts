/**
 * `/api/person/*` — 사람만 하는 일(기록 설계 §3.4 · §3.5, R1-3). 다리만 안다(층 2): 호스트의 사람 얼굴(`recordsPerson`)은 같은 프로세스의
 * 적재기가 건넨 것이고 HTTP · MCP 로 드러나지 않는다. 이 경로가 받는 요청(층 3):
 *  - 읽기 인증(쿠키 · Bearer — 다리 토큰. MCP 토큰은 다른 토큰이라 401) + 쓰기 열쇠(POST — 맨 위 틀의 스크립트에만 붙는다,
 *    Electron 은 맨 위 틀에서 사람의 입력이 있은 뒤 2 초 안에만 — 층 4, 껍데기가 한다)
 *  - `Origin` = 틀 출처, `Sec-Fetch-Site: same-origin`(끼운 웹뷰는 다른 출처 — 거절), `Content-Type: application/json`, 본문 4 KB 까지
 *  - 본문의 경로 · 폴더는 읽지 않는다 — 폴더 · 이름은 호스트의 물음(OS 대화상자 · 이름 물음)이 사람에게 묻는다. caseId 도 받지 않는다(지금 열린 대상)
 *
 * 경로: GET recent · POST open-folder · new-project · open-project {name} · open-case {name} · new-case {kind} · make-project · take-lock · archive {archived}.
 * relink · 작성자 이름 · 밖에서 바뀐 파일 덮어쓰기는 호스트의 사람 얼굴에 아직 없다 — 501 과 그 까닭(호스트에 바라는 것)
 */
import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';
import type { HostHandle } from '../loader';
import type { BridgePlatform } from './platform';
import { readBody, sendJson } from './http';

export const PERSON_BODY_LIMIT = 4 * 1024;
const KINDS = ['roof-purlin', 'wall-girt', 'floor-joist', 'wall-stud', 'section-only'] as const;
const KIND_KO: Record<string, string> = { 'roof-purlin': '지붕 퍼린', 'wall-girt': '벽 거트', 'floor-joist': '바닥 장선', 'wall-stud': '스터드', 'section-only': '단면만' };

export interface PersonDeps {
  host: HostHandle;
  platform: BridgePlatform;
  /** 틀 출처(http://127.0.0.1:<포트>) */
  origin: string;
  /** 호스트 동작(화면 비밀 머리를 붙인 — 사람의 것으로 적힌다) */
  action(body: Record<string, unknown>): Promise<any>;
  log(line: string): void;
  /** 화면이 다시 읽게(파일 · 프로젝트가 바뀌었다) */
  changed(what: string): void;
  /** 검토 대상을 바꾸기 전에 — 저장 안 한 변경을 묻는 하나의 함수(V7-41). false = 취소 */
  replaceGuard(): Promise<boolean>;
}

/** 요청이 사람의 길로 왔는가(층 3 의 다리 쪽) — 아니면 [상태, 까닭] */
function refuse(req: http.IncomingMessage, origin: string): [number, string] | null {
  const o = req.headers.origin;
  if (o !== origin) { return [403, `Origin 이 틀이 아니다(${String(o ?? '없음')})`]; }
  const site = String(req.headers['sec-fetch-site'] ?? '');
  if (site !== 'same-origin') { return [403, `Sec-Fetch-Site 가 same-origin 이 아니다(${site || '없음'})`]; }
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] ?? ''))) { return [415, 'Content-Type: application/json 이어야 한다']; }
  return null;
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, PERSON_BODY_LIMIT);
  if (buf.length === 0) { return {}; }
  const j = JSON.parse(buf.toString('utf8'));
  return j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, unknown> : {};
}

/** 처리했으면 true */
export async function handlePerson(req: http.IncomingMessage, res: http.ServerResponse, p: string, deps: PersonDeps): Promise<boolean> {
  const m = /^\/api\/person\/([a-z-]+)$/.exec(p);
  if (!m) { return false; }
  const name = m[1];
  const method = req.method ?? 'GET';
  const ok = (data: unknown) => sendJson(res, 200, { success: true, data });
  const no = (status: number, error: string, extra: Record<string, unknown> = {}) => sendJson(res, status, { success: false, error, ...extra });

  if (name === 'recent' && method === 'GET') {
    // 최근 · 뿌리의 프로젝트(이름 · 대상 수 · 마지막 작업). 경로는 화면에만 보일 자리지만 호스트가 아직 주지 않는다(바라는 것)
    const r = await deps.action({ action: 'list_projects', limit: 20 });
    if (r?.error) { no(200, String(r.error)); return true; }
    ok({ projects: Array.isArray(r?.projects) ? r.projects : [], total: r?.total ?? 0, roots: deps.host.projectRoots(),
      path_note: '프로젝트 폴더의 경로는 호스트가 아직 주지 않는다(사람의 얼굴에 최근 목록 · 경로를 바란다)' });
    return true;
  }
  if (method !== 'POST') { no(405, 'POST'); return true; }
  const bad = refuse(req, deps.origin);
  if (bad) { no(bad[0], bad[1]); return true; }
  let b: Record<string, unknown>;
  try { b = await body(req); } catch (err) { no((err as { status?: number }).status ?? 400, String((err as Error).message)); return true; }
  const person = deps.host.recordsPerson();
  const status = async () => (await deps.action({ action: 'get_full_state' }))?.project ?? null;
  try {
    switch (name) {
      case 'open-folder': {
        // 본문의 경로 · 폴더는 쓰지 않는다 — 폴더는 OS 대화상자로 사람이 고른다
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const picked = await deps.platform.fileDialog({ kind: 'open', canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          title: '프로젝트 폴더 열기', openLabel: '이 폴더 열기', defaultPath: deps.host.projectRoots()[0] });
        const dir = picked?.[0];
        if (!dir) { ok({ cancelled: true }); return true; }
        const s = person.openFolder(dir);
        deps.log(`[person] 폴더를 프로젝트로 열었다: ${s.name}`);
        deps.changed('project');
        ok({ project: { name: s.name, read_only: s.readOnly, cases: s.cases, notices: s.warnings } });
        return true;
      }
      case 'new-project': {
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const root = deps.host.projectRoots()[0];
        if (!root) { no(409, '프로젝트 뿌리가 없다'); return true; }
        const nm = (await deps.platform.input({ title: '새 프로젝트', prompt: `프로젝트 이름 — ${root} 아래에 만든다`, placeHolder: '물류창고 지붕' }))?.trim();
        if (!nm) { ok({ cancelled: true }); return true; }
        fs.mkdirSync(root, { recursive: true });
        const s = person.createProject(path.resolve(root), nm);
        deps.changed('project');
        ok({ project: { name: s.name, read_only: s.readOnly, cases: s.cases, notices: s.warnings } });
        return true;
      }
      case 'open-case': {
        // 프로젝트의 검토 대상을 이름으로 연다(경로를 받지 않는다) — 저장 안 한 변경이 있으면 먼저 묻는다(하나의 함수)
        const nm = typeof b.name === 'string' ? b.name.slice(0, 200) : '';
        if (!nm) { no(400, 'name(검토 대상 이름)'); return true; }
        if (!(await deps.replaceGuard())) { ok({ cancelled: true }); return true; }
        const o = await deps.action({ action: 'open_case', name: nm, report_units: 'SI' });
        if (o?.error) { no(200, String(o.error)); return true; }
        deps.changed('case');
        ok({ opened: o.opened, read_only: o.read_only, read_only_reason: o.read_only_reason ?? null });
        return true;
      }
      case 'open-project': {
        // 최근 · 뿌리의 프로젝트를 이름으로(open_project — 대상은 열지 않는다, 화면의 값은 그대로)
        const nm = typeof b.name === 'string' ? b.name.slice(0, 200) : '';
        if (!nm) { no(400, 'name(프로젝트 이름)'); return true; }
        const o = await deps.action({ action: 'open_project', name: nm });
        if (o?.error) { no(200, String(o.error)); return true; }
        deps.changed('project');
        ok({ project: o.project, previous_case_closed: o.previous_case_closed ?? null });
        return true;
      }
      case 'new-case': {
        const kind = String(b.kind ?? '');
        if (!(KINDS as readonly string[]).includes(kind)) { no(400, `kind 는 ${KINDS.join(' · ')}`); return true; }
        const st = await status();
        if (!st?.inProject) { no(409, '열린 프로젝트가 없다 — 먼저 「폴더에서 열기」나 「새 프로젝트」'); return true; }
        const nm = (await deps.platform.input({ title: `새 검토 — ${KIND_KO[kind]}`, prompt: `검토 대상 이름(프로젝트 ${st.project?.name ?? ''} 안)`, placeHolder: '퍼린 P1' }))?.trim();
        if (!nm) { ok({ cancelled: true }); return true; }
        if (!(await deps.replaceGuard())) { ok({ cancelled: true }); return true; }
        const c = await deps.action({ action: 'new_case', name: nm, kind });
        if (c?.error) { no(200, String(c.error)); return true; }
        const o = await deps.action({ action: 'open_case', name: c.created ?? nm, report_units: 'SI' });
        if (o?.error) { no(200, String(o.error)); return true; }
        deps.changed('case');
        ok({ created: c.created, opened: o.opened });
        return true;
      }
      case 'make-project': {
        // 「프로젝트로 만들기」(설계 2.5): 열린 프로젝트에 지금 파일을 복사해 새 대상으로(new_case from current — import 줄 · 원본 sha256)
        const st = await status();
        if (!st?.inProject) { no(409, '열린 프로젝트가 없다 — 먼저 프로젝트를 고르거나 만든다(「폴더에서 열기」 · 「새 프로젝트」)', { need: 'project' }); return true; }
        const nm = (await deps.platform.input({ title: '프로젝트로 만들기', prompt: `프로젝트 ${st.project?.name ?? ''} 의 새 검토 대상 이름(지금 파일을 복사한다 — 원본은 그대로)` }))?.trim();
        if (!nm) { ok({ cancelled: true }); return true; }
        const c = await deps.action({ action: 'new_case', name: nm, kind: 'section-only', from: 'current' });
        if (c?.error) { no(200, String(c.error)); return true; }
        const o = await deps.action({ action: 'open_case', name: c.created ?? nm, report_units: 'SI' });
        if (o?.error) { no(200, String(o.error)); return true; }
        deps.changed('case');
        ok({ created: c.created, opened: o.opened });
        return true;
      }
      case 'take-lock': {
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const st = await status();
        const c = st?.case;
        if (!c?.caseId) { no(409, '열린 검토 대상이 없다'); return true; }
        if (!c.lock) { no(409, '이 대상은 다른 곳이 잠그지 않았다'); return true; }
        const yes = await deps.platform.notify({ severity: 'warning', modal: true, items: ['넘겨받기', '취소'],
          message: `${c.lock.name} (${c.lock.host}) 이(가) ${c.lock.since} 부터 이 검토 대상을 잠그고 있습니다 — 넘겨받을까요?`,
          detail: '넘겨받으면 그쪽의 저장은 거절됩니다. 그쪽이 아직 작업 중이면 먼저 그 사람과 이야기하세요.' });
        if (yes !== '넘겨받기') { ok({ cancelled: true }); return true; }
        person.takeLock(String(c.caseId));
        deps.changed('case');
        ok({ took: c.name });
        return true;
      }
      case 'archive': {
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const st = await status();
        const c = st?.case;
        if (!c?.caseId) { no(409, '열린 검토 대상이 없다'); return true; }
        person.archive(String(c.caseId), b.archived !== false);
        deps.changed('case');
        ok({ archived: b.archived !== false, case: c.name });
        return true;
      }
      case 'relink': case 'writer-name': case 'overwrite':
        no(501, `호스트의 사람 얼굴에 아직 없다(${name}) — RecordsDesk.person 에 바란다`);
        return true;
      default:
        no(404, `없는 사람 경로: ${name}`);
        return true;
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    deps.log(`[person] ${name} 실패: ${msg}`);
    no(200, msg);
    return true;
  }
}
