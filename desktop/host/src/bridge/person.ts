/**
 * `/api/person/*` — 사람만 하는 일(기록 설계 §3.4 · §3.5, R1-3). 다리만 안다(층 2): 호스트의 사람 얼굴(`recordsPerson`)은 같은 프로세스의
 * 적재기가 건넨 것이고 HTTP · MCP 로 드러나지 않는다. 이 경로가 받는 요청(층 3):
 *  - 읽기 인증(쿠키 · Bearer — 다리 토큰. MCP 토큰은 다른 토큰이라 401) + 쓰기 열쇠(POST — 맨 위 틀의 스크립트에만 붙는다,
 *    Electron 은 맨 위 틀에서 사람의 입력이 있은 뒤 2 초 안에만 — 층 4, 껍데기가 한다)
 *  - `Origin` = 틀 출처, `Sec-Fetch-Site: same-origin`(끼운 웹뷰는 다른 출처 — 거절), `Content-Type: application/json`, 본문 4 KB 까지
 *  - 본문의 경로 · 폴더는 읽지 않는다 — 폴더 · 파일 · 이름은 호스트의 물음(OS 대화상자 · 이름 물음)이 사람에게 묻는다.
 *    대상은 `case_id`(경로가 아니다 — 열린 프로젝트의 list_cases 에 있는 것만) 또는 지금 열린 대상
 *
 * 경로: GET recent(최근 · 뿌리의 프로젝트와 폴더 경로 · 지금 프로젝트 · 작성자 이름 — 사람의 얼굴에서, 215cb5a) · POST open-folder · new-project ·
 * open-project {name} · open-case {name} · new-case {kind} · make-project · take-lock {case_id?} · archive {case_id?, archived} ·
 * relink {case_id?}(파일은 OS 대화상자) · writer-name(이름 물음) · overwrite(밖에서 바뀐 파일을 덮어써도 된다 → 저장) · edit-session {state}(R2-3) ·
 * review {mark, targets[]}(R4 — 확인 표시, shown = 화면이 그린 지문) · trust {writer_id, trust}(R4 — 다른 작성자 믿기) ·
 * issue/preview(R5 — 발행 미리보기: 막는 것 · 지문 · 일회용 숫자 + 초안의 HTML) · issue {fingerprint, nonce}(R5 — 발행, 인쇄를 기다린다) ·
 * alternative {op, item?, label?}(R4 — 대안을 사람이 지키기 · 이름 · 숨기기 · 다시 보이기) ·
 * export {item}(R5 — 초안을 사람의 저장 대화상자로) · open-doc {item}(R5 — 초안 · 발행본의 PDF 를 OS 로) · GET doc-file?item=(R5 — 그 HTML, 읽기만)
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
  const m = /^\/api\/person\/([a-z-]+(?:\/[a-z-]+)?)$/.exec(p);
  if (!m) { return false; }
  const name = m[1];
  const method = req.method ?? 'GET';
  const ok = (data: unknown) => sendJson(res, 200, { success: true, data });
  const no = (status: number, error: string, extra: Record<string, unknown> = {}) => sendJson(res, status, { success: false, error, ...extra });

  if (name === 'recent' && method === 'GET') {
    // 최근 · 뿌리의 프로젝트(이름 · 폴더 경로 · 대상 수 · 마지막 작업) · 지금 프로젝트 · 작성자 이름 — 사람의 얼굴에서(경로는 이 화면에만)
    const person = deps.host.recordsPerson();
    if (!person) {
      const r = await deps.action({ action: 'list_projects', limit: 20 });
      if (r?.error) { no(200, String(r.error)); return true; }
      ok({ projects: Array.isArray(r?.projects) ? r.projects : [], total: r?.total ?? 0, roots: deps.host.projectRoots(), current: null, writer: null });
      return true;
    }
    try {
      const list = person.projects().slice(0, 20).map(x => ({ name: x.name, dir: x.dir, cases: x.cases, last_work: x.lastWork, open: x.open }));
      ok({ projects: list, total: list.length, roots: deps.host.projectRoots(), current: person.currentProject(), writer: person.writerName() });
    } catch (err) { no(200, String((err as Error)?.message ?? err)); }
    return true;
  }
  if (name === 'doc-file' && method === 'GET') {
    // R5-3: 초안 · 발행본의 HTML(읽기만 — 화면은 sandbox 틀에). 기록에 있는 그 문서의 폴더 안 파일만
    const person = deps.host.recordsPerson();
    const cur = person?.currentProject();
    if (!person || !cur) { no(409, '열린 프로젝트가 없다'); return true; }
    let item = '';
    try { item = new URL(req.url ?? '', 'http://x').searchParams.get('item') ?? ''; } catch { item = ''; }
    const f = await docFiles(deps, cur.dir, item.slice(0, 40));
    if (!f) { no(404, '그 문서가 없다'); return true; }
    const html = f.files.find(x => /\.html?$/i.test(x));
    let text: string | null = null;
    if (html) { try { if (fs.statSync(html).size <= 16 * 1024 * 1024) { text = fs.readFileSync(html, 'utf8'); } } catch { text = null; } }
    ok({ item, kind: f.kind, name: html ? path.basename(html) : null, html: text, files: f.files.map(x => path.basename(x)) });
    return true;
  }
  if (method !== 'POST') { no(405, 'POST'); return true; }
  const bad = refuse(req, deps.origin);
  if (bad) { no(bad[0], bad[1]); return true; }
  let b: Record<string, unknown>;
  try { b = await body(req); } catch (err) { no((err as { status?: number }).status ?? 400, String((err as Error).message)); return true; }
  const person = deps.host.recordsPerson();
  const status = async () => (await deps.action({ action: 'get_full_state' }))?.project ?? null;
  /** 본문의 case_id — 열린 프로젝트의 대상(list_cases)에 있는 것만. 없으면 지금 열린 대상 */
  const target = async (): Promise<{ caseId: string; name: string; open: boolean } | null> => {
    if (typeof b.case_id === 'string' && b.case_id) {
      const lc = await deps.action({ action: 'list_cases', include_archived: true });
      const hit = (Array.isArray(lc?.cases) ? lc.cases : []).find((c: any) => c.case_id === b.case_id);
      return hit ? { caseId: String(hit.case_id), name: String(hit.name), open: !!hit.open } : null;
    }
    const c = (await status())?.case;
    return c?.caseId ? { caseId: String(c.caseId), name: String(c.name), open: true } : null;
  };
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
        const t = await target();
        if (!t) { no(409, typeof b.case_id === 'string' ? '그 대상이 열린 프로젝트에 없다' : '열린 검토 대상이 없다'); return true; }
        // 열린 대상이면 잠금이 누구 것인지 보인다(열지 않은 대상은 목록에 잠금 정보가 없다 — 넘겨받는다고만 묻는다)
        const lock = t.open ? (await status())?.case?.lock ?? null : null;
        if (t.open && !lock) { no(409, '이 대상은 다른 곳이 잠그지 않았다'); return true; }
        const yes = await deps.platform.notify({ severity: 'warning', modal: true, items: ['넘겨받기', '취소'],
          message: lock ? `${lock.name} (${lock.host}) 이(가) ${lock.since} 부터 「${t.name}」을(를) 잠그고 있습니다 — 넘겨받을까요?` : `「${t.name}」의 잠금을 넘겨받을까요?`,
          detail: '넘겨받으면 그쪽의 저장은 거절됩니다. 그쪽이 아직 작업 중이면 먼저 그 사람과 이야기하세요.' });
        if (yes !== '넘겨받기') { ok({ cancelled: true }); return true; }
        person.takeLock(t.caseId);
        deps.changed('case');
        ok({ took: t.name });
        return true;
      }
      case 'archive': {
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const t = await target();
        if (!t) { no(409, typeof b.case_id === 'string' ? '그 대상이 열린 프로젝트에 없다' : '열린 검토 대상이 없다'); return true; }
        person.archive(t.caseId, b.archived !== false);
        deps.changed('case');
        ok({ archived: b.archived !== false, case: t.name });
        return true;
      }
      case 'relink': {
        // 옮긴 · 이름을 바꾼 대상을 다시 잇는다 — 파일은 OS 대화상자로 사람이 고른다(본문의 경로는 읽지 않는다)
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const t = await target();
        if (!t) { no(409, typeof b.case_id === 'string' ? '그 대상이 열린 프로젝트에 없다' : '열린 검토 대상이 없다'); return true; }
        const cur = person.currentProject();
        const picked = await deps.platform.fileDialog({ kind: 'open', canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          title: `「${t.name}」의 파일 다시 잇기`, openLabel: '이 파일로 잇기', filters: { 'StCFSD 검토 대상': ['csd'] },
          defaultPath: cur ? path.join(cur.dir, '02_검토대상') : undefined });
        const file = picked?.[0];
        if (!file) { ok({ cancelled: true }); return true; }
        const r = person.relink(t.caseId, file);
        deps.changed('case');
        ok({ relinked: t.name, file: path.basename(r.file) });
        return true;
      }
      case 'writer-name': {
        // 작성자 이름(잠금 · 작성자 소개에 쓰인다) — 이름 물음, 지금 이름이 기본
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const now = person.writerName();
        const nm = (await deps.platform.input({ title: '작성자 이름', prompt: '잠금 · 기록의 작성자 소개에 보이는 이름', value: now }))?.trim();
        if (!nm || nm === now) { ok({ cancelled: !nm, writer: now }); return true; }
        const set = person.setWriterName(nm);
        deps.changed('writer');
        ok({ writer: set });
        return true;
      }
      case 'overwrite': {
        // 밖에서 바뀐 파일을 덮어쓴다 — 사람이 「덮어쓰기」를 눌렀다: 호스트가 external 줄을 남기고 대조를 지금 파일로 → 저장
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const yes = await deps.platform.notify({ severity: 'warning', modal: true, items: ['덮어쓰기', '취소'],
          message: '저장한 뒤 다른 곳에서 바뀐 파일을 지금 화면의 내용으로 덮어쓸까요?', detail: '밖에서 바뀐 내용은 기록(「밖에서」 변경 한 줄)에 남고 파일에서는 사라집니다.' });
        if (yes !== '덮어쓰기') { ok({ cancelled: true }); return true; }
        person.allowOverwrite();
        const sv = await deps.action({ action: 'save_case' });
        if (sv?.error) { no(200, String(sv.error)); return true; }
        deps.changed('case');
        ok({ saved: true });
        return true;
      }
      case 'edit-session': {
        // R2-3: 편집 상태의 시작 · 끝 · 버리기 — 그 사이의 사람 편집이 묶음 하나(호스트 editSession, 사람의 문맥)
        const st = String(b.state ?? '');
        if (!['start', 'end', 'discard'].includes(st)) { no(400, 'state 는 start · end · discard'); return true; }
        const r = deps.host.editSession(st as 'start' | 'end' | 'discard');
        if (!r) { no(409, '설계 패널이 없다'); return true; }
        if (!r.ok) { no(200, '호스트가 받지 않았다'); return true; }
        deps.changed('changes');
        ok({ state: st, ...(r.backToStart !== undefined ? { back_to_start: r.backToStart } : {}), ...(Array.isArray(r.restored) ? { restored: r.restored.slice(0, 200) } : {}) });
        return true;
      }
      case 'review': {
        // R4: 확인 표시 — 사람의 길로만(층 3 · 4). 대상의 꼴만 보고 호스트의 사람 얼굴에 넘긴다: 지금 지문과 다르면(다른 판을 보았다) 호스트가 던진다
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const raw = Array.isArray(b.targets) ? b.targets : null;
        if (!raw || !raw.length || raw.length > 200) { no(400, 'targets 는 1 – 200 개'); return true; }
        const TYPES = ['check', 'result', 'group', 'change', 'work', 'assumption'];
        const str = (v: unknown, n: number) => (typeof v === 'string' && v.length > 0 && v.length <= n ? v : undefined);
        const targets: Array<Record<string, unknown>> = [];
        for (const t of raw) {
          const o = t && typeof t === 'object' && !Array.isArray(t) ? t as Record<string, unknown> : null;
          if (!o || !TYPES.includes(String(o.type))) { no(400, `대상의 type 은 ${TYPES.join(' · ')}`); return true; }
          const shown = typeof o.shown === 'number' && Number.isInteger(o.shown) ? o.shown : str(o.shown, 200);
          if (shown === undefined) { no(400, 'shown(화면이 그린 지문)이 없다'); return true; }
          targets.push({ type: o.type, shown, ...(str(o.key, 2000) ? { key: o.key } : {}), ...(str(o.kind, 40) ? { kind: o.kind } : {}), ...(str(o.group, 40) ? { group: o.group } : {}),
            ...(str(o.changeId, 80) ? { changeId: o.changeId } : {}), ...(str(o.id, 40) ? { id: o.id } : {}) });
        }
        const r = person.review({ mark: b.mark !== false, targets });
        deps.changed('reviews');
        ok({ event: r.event, targets: r.targets });
        return true;
      }
      case 'trust': {
        // R4: 다른 작성자를 믿기 — 사람만. 그 작성자 소개가 프로젝트에 있어야(호스트가 본다)
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const w = typeof b.writer_id === 'string' ? b.writer_id.slice(0, 40) : '';
        if (!/^w[a-z2-7]{20}$/.test(w)) { no(400, 'writer_id(작성자 id)'); return true; }
        const r = person.trust(w, b.trust !== false);
        deps.changed('reviews');
        ok({ writer: r.name, trusted: r.trusted });
        return true;
      }
      case 'alternative': {
        // R4(de93aa9): 대안을 지키기 · 이름 바꾸기 · 숨기기 · 다시 보이기 — 사람만(호스트의 person.alternative, 행위자 표에 사람)
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const op = String(b.op ?? '');
        if (!['keep', 'rename', 'drop', 'undrop'].includes(op)) { no(400, 'op 는 keep · rename · drop · undrop'); return true; }
        const item = typeof b.item === 'string' && /^[A-Za-z0-9~-]{1,40}$/.test(b.item) ? b.item : undefined;
        if (op !== 'keep' && !item) { no(400, 'item(대안 id)'); return true; }
        const label = typeof b.label === 'string' ? b.label.slice(0, 120) : undefined;
        if (op === 'rename' && !label?.trim()) { no(400, 'label(새 이름)'); return true; }
        const r = person.alternative({ op: op as 'keep' | 'rename' | 'drop' | 'undrop', ...(item ? { item } : {}), ...(label !== undefined ? { label } : {}) });
        deps.changed('alternatives');
        ok({ item: r.item, event: r.event });
        return true;
      }
      case 'issue/preview': {
        // R5-2: 발행 미리보기(사람의 길) — 호스트의 issuePreview(디스크에 아무것도 쓰지 않는다) + 그 초안의 HTML(미리보기 그림 — 화면은 sandbox 틀에)
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const pv = person.issuePreview();
        const cur = person.currentProject();
        let draftHtml: string | null = null;
        const hf = (pv.draft?.files ?? []).find(f => /\.html?$/i.test(f));
        if (cur && hf) { const abs = insideProject(cur.dir, hf, '03_계산서'); if (abs) { try { const st = fs.statSync(abs); if (st.size <= 16 * 1024 * 1024) { draftHtml = fs.readFileSync(abs, 'utf8'); } } catch { draftHtml = null; } } }
        ok({ ...pv, draft_html: draftHtml });
        return true;
      }
      case 'issue': {
        // R5-2: 발행 — 사람이 미리보기의 「R<n> 발행」을 눌렀다. 호스트가 점검을 다시 하고(지문) 일회용 숫자를 본 뒤 인쇄까지 기다린다
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const fp = typeof b.fingerprint === 'string' ? b.fingerprint.slice(0, 200) : '';
        const nonce = typeof b.nonce === 'string' ? b.nonce.slice(0, 200) : '';
        if (!fp || !nonce) { no(400, 'fingerprint · nonce(미리보기의 것)'); return true; }
        deps.log('[person] 발행 — 인쇄를 기다린다');
        let r: Awaited<ReturnType<typeof person.issue>>;
        // 거절(숫자가 지남 · 이미 씀 · 그 사이 바뀜 · 막는 것 …)은 호스트가 code(host.issue.*)와 함께 던진다 — 아래 catch 가 error_code 로
        try { r = await person.issue({ fingerprint: fp, nonce }); } catch (err) { deps.changed('documents'); throw err; }
        deps.changed('documents');
        ok({ item: r.item, folder: r.folder, files: r.files.map(f => ({ path: f.path, sha256: f.sha256, size: f.size, role: f.role ?? null })) });
        return true;
      }
      case 'export': {
        // R5-3: 「초안으로 내보내기」 — 막는 것과 무관하게, 사람의 저장 대화상자로 그 초안의 파일(PDF 가 있으면 PDF, 없으면 HTML)을 복사한다
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const cur = person.currentProject();
        if (!cur) { no(409, '열린 프로젝트가 없다'); return true; }
        const ls = await deps.action({ action: 'documents', op: 'list' });
        const drafts: any[] = Array.isArray(ls?.drafts) ? ls.drafts : [];
        const dr = typeof b.item === 'string' ? drafts.find(x => x.item === b.item) : drafts[0];
        if (!dr) { no(404, '내보낼 초안이 없다 — 먼저 계산서를 만든다'); return true; }
        const rel: string | undefined = (dr.files as string[]).find(f => /\.pdf$/i.test(f)) ?? (dr.files as string[]).find(f => /\.html?$/i.test(f));
        const src = rel ? insideProject(cur.dir, rel, '03_계산서') : null;
        if (!src || !fs.existsSync(src)) { no(404, '초안의 파일이 없다'); return true; }
        const picked = await deps.platform.fileDialog({ kind: 'save', title: '초안으로 내보내기', saveLabel: '내보내기', defaultPath: path.basename(src),
          filters: /\.pdf$/i.test(src) ? { PDF: ['pdf'] } : { HTML: ['html'] } });
        let to = picked?.[0];
        if (!to) { ok({ cancelled: true }); return true; }
        // 사람이 다른 확장자를 적었으면 원본의 확장자를 붙인다(PDF 를 .html 로, HTML 을 .pdf 로 내보내지 않는다)
        if (path.extname(to).toLowerCase() !== path.extname(src).toLowerCase()) { to = `${to}${path.extname(src)}`; }
        fs.copyFileSync(src, to);
        ok({ exported: path.basename(to), draft: dr.item });
        return true;
      }
      case 'open-doc': {
        // R5-3: 초안 · 발행본의 PDF 를 OS 의 기본 앱으로(읽기만 — 이 프로그램은 고치지 않는다). 03_계산서 · 04_발행본 안의 그 문서의 파일만
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const cur = person.currentProject();
        if (!cur) { no(409, '열린 프로젝트가 없다'); return true; }
        const f = await docFiles(deps, cur.dir, String(b.item ?? ''));
        const pdf = f?.files.find(x => /\.pdf$/i.test(x));
        if (!f || !pdf) { no(404, '그 문서의 PDF 가 없다'); return true; }
        const opened = await deps.platform.openPath(pdf);
        ok({ name: path.basename(pdf), opened });
        return true;
      }
      case 'open-source': {
        // R3-3: 원자료 하나를 OS 의 기본 앱으로 — id 로만(본문의 경로는 읽지 않는다). 그 파일은 호스트가 등록한 01_원자료 안의 상대경로,
        // 프로젝트 폴더는 사람의 얼굴에서. 폴더 밖 · 링크는 열지 않는다. 내용은 읽지 않는다(AI 에게 가지 않는다)
        if (!person) { no(409, '기록을 쓸 수 없다(열쇠 자리가 없다)'); return true; }
        const id = typeof b.id === 'string' ? b.id.slice(0, 40) : '';
        if (!id) { no(400, 'id(원자료)'); return true; }
        const cur = person.currentProject();
        if (!cur) { no(409, '열린 프로젝트가 없다'); return true; }
        const ls = await deps.action({ action: 'sources', op: 'list', include_others: true });
        const hit = (Array.isArray(ls?.items) ? ls.items : []).find((x: any) => x?.item === id);
        if (!hit || typeof hit.file !== 'string') { no(404, '그 원자료가 없다'); return true; }
        const base = path.resolve(cur.dir, '01_원자료');
        const abs = path.resolve(base, hit.file);
        const inside = abs.toLowerCase().startsWith(base.toLowerCase() + path.sep);
        let plain = false;
        try { const st2 = fs.lstatSync(abs); plain = st2.isFile() && !st2.isSymbolicLink(); } catch { plain = false; }
        if (!inside || !plain) { no(409, '원자료 폴더 안의 파일이 아니다(없음 · 링크 · 폴더 밖)'); return true; }
        const opened = await deps.platform.openPath(abs);
        ok({ opened, name: path.basename(abs) });
        return true;
      }
      default:
        no(404, `없는 사람 경로: ${name}`);
        return true;
    }
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    deps.log(`[person] ${name} 실패: ${msg}`);
    // 호스트의 거절 부호(host.review.* 등) — 화면은 그 부호의 한국어 문장을 보인다
    const code = typeof (err as { code?: unknown })?.code === 'string' && /^host\.[a-z_.-]{1,80}$/.test((err as { code: string }).code) ? (err as { code: string }).code : undefined;
    no(200, msg, code ? { error_code: code } : {});
    return true;
  }
}

/** 프로젝트 폴더 안의 상대경로(그 폴더 아래 · 링크 아님)를 절대 경로로 — 아니면 null */
function insideProject(dir: string, rel: string, top: string): string | null {
  const base = path.resolve(dir, top);
  const abs = path.resolve(dir, rel);
  if (!abs.toLowerCase().startsWith(base.toLowerCase() + path.sep)) { return null; }
  try { if (fs.lstatSync(abs).isSymbolicLink()) { return null; } } catch { return abs; }
  return abs;
}

/** 기록에 있는 초안 · 발행의 파일(절대 경로) — documents list 가 준 것만, 03_계산서 · 04_발행본 안만 */
async function docFiles(deps: PersonDeps, dir: string, item: string): Promise<{ kind: 'draft' | 'issue'; files: string[] } | null> {
  if (!/^[A-Za-z0-9-]{1,40}$/.test(item)) { return null; }
  const ls = await deps.action({ action: 'documents', op: 'list' });
  const dr = (Array.isArray(ls?.drafts) ? ls.drafts : []).find((x: any) => x.item === item);
  if (dr) { return { kind: 'draft', files: (dr.files as string[]).map(f => insideProject(dir, f, '03_계산서')).filter((x): x is string => !!x) }; }
  const is = (Array.isArray(ls?.issues) ? ls.issues : []).find((x: any) => x.item === item);
  if (!is) { return null; }
  const folder = insideProject(dir, String(is.folder), '04_발행본');
  if (!folder) { return null; }
  let names: string[] = [];
  try { names = fs.readdirSync(folder).filter(n => /\.(html?|pdf|csd|json)$/i.test(n)); } catch { names = []; }
  // 계산서(.calc.)를 먼저 — 미리보기 · 「PDF 열기」 는 계산서
  names.sort((a, b2) => Number(!/\.calc\./.test(a)) - Number(!/\.calc\./.test(b2)) || a.localeCompare(b2));
  return { kind: 'issue', files: names.map(n => path.join(folder, n)).filter(x => insideProject(dir, path.relative(dir, x), '04_발행본')) };
}
