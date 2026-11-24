/* global require, module, Buffer, __dirname */
// R1-2(1 걸음) — 데스크(src/records/desk.ts): 프로젝트 · 검토 대상 · 잠금 · 색인 · 실행 이력 · 열기 · 저장 훅 · 상태 · 사람만의 얼굴.
// 패널 없이 — 모든 것을 주입한다(임시 폴더의 뿌리 · 열쇠 자리, 가짜 시계 · 엔진 id). 진짜 %LOCALAPPDATA% · %APPDATA% 를 쓰지 않는다.
// 적대적인 것(⚔): 꾸민 프로젝트 폴더(선언에 폴더 역할 · 절대 경로, 남의 열쇠로 서명한 줄, 해시가 틀린 사본, 심은 잠금, 미리 만든 발행 폴더)는
// 어디에도 쓰지 않고 열린다 · 밖에서 바뀐 .csd 는 저장하지 않는다 · 이름 · 경로는 names · fsx 로만 · junction · 링크 · 하드 링크 · ADS ·
// 장치 이름 · 보호 폴더 안의 프로젝트 · 두 프로세스.
'use strict';
const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { rec, tmp, tryLink, suite } = require('./_harness');

/** 폴더 나무의 모든 파일 · 폴더(경로 → 크기 · 내용 해시) — 「어디에도 쓰지 않았다」 를 보려고 */
function tree(dir) {
  const out = {};
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      const rel = path.relative(dir, p);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) { out[rel] = 'link'; continue; }
      if (e.isDirectory()) { out[rel + '/'] = 'dir'; walk(p); continue; }
      out[rel] = `${st.size}:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16)}`;
    }
  };
  walk(dir);
  return out;
}
const changed = (a, b) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
};

async function run() {
  const { t, done } = suite('records_desk');
  const D = rec('desk'), B = rec('blobs'), K = rec('locks'), W = rec('writer'), L = rec('log'), CS = rec('cases'), CX = rec('context'), P = rec('project');
  const ENGINE = 'sha256:' + 'a'.repeat(64), ENGINE2 = 'sha256:' + 'b'.repeat(64);

  /** 세계 하나: 뿌리 · 열쇠 자리 · 시계 · 데스크 만들기 */
  const world = (o = {}) => {
    const base = tmp();
    const root = path.join(base, 'projects'); fs.mkdirSync(root);
    const keyDir = path.join(base, 'key');
    let clock = 0;
    let engine = ENGINE;
    const ctxRef = { ctx: undefined };
    const make = (extra = {}) => new D.RecordsDesk({
      keyDir, roots: () => [root], recentProjects: () => o.recent || [], protectedRoots: () => o.protected || [],
      now: () => new Date(Date.UTC(2026, 10, 24, 10, 0, 0) + 1000 * (clock++)).toISOString(),
      host: 'test-host', version: 'test', engineId: () => engine, writerName: 'Tester',
      currentContext: () => ctxRef.ctx, ...extra,
    });
    return { base, root, keyDir, make, ctxRef, setEngine: (e) => { engine = e; } };
  };
  const csd = (record, extra = {}) => JSON.stringify({ version: '1.4', model: { node: [[1, 0, 0]], elem: [], sectionTemplate: 'lippedz' },
    case: { inputs: { memberType: 'roof-purlin', presteelGrade: 'SGC400' } }, ...(record ? { record } : {}), ...extra });

  // ── 프로젝트 ────────────────────────────────────────────────────
  await t('open_project {create} makes the declaration and the four folders only — no .stcfsd/ until a line is written', () => {
    const w = world(); const desk = w.make();
    const s = desk.openProject('물류창고 지붕', { create: true });
    assert.strictEqual(s.name, '물류창고 지붕');
    const dir = path.join(w.root, '물류창고 지붕');
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['01_원자료', '02_검토대상', '03_계산서', '04_발행본', 'stcfsd-project.json'].sort());
    assert(!fs.existsSync(w.keyDir), 'opening a project does not create the writer key');
    const again = w.make().openProject('물류창고 지붕');
    assert.strictEqual(again.projectId, s.projectId, 'opened by name (NFC · case-insensitive) — not created twice');
  });
  await t('list_projects gives names only (no path), pages with a cursor, skips folders without a valid declaration', () => {
    const w = world(); const desk = w.make();
    for (const n of ['A1', 'B2', 'C3']) { desk.openProject(n, { create: true }); }
    fs.mkdirSync(path.join(w.root, 'not-a-project'));
    fs.mkdirSync(path.join(w.root, 'bad-decl')); fs.writeFileSync(path.join(w.root, 'bad-decl', 'stcfsd-project.json'), '{"schema":"x"}');
    const p1 = desk.listProjects({ limit: 2 });
    assert.deepStrictEqual(p1.projects.map((p) => p.name), ['A1', 'B2']);
    assert.strictEqual(p1.total, 3);
    const p2 = desk.listProjects({ limit: 2, cursor: p1.next });
    assert.deepStrictEqual(p2.projects.map((p) => p.name), ['C3']);
    assert.strictEqual(p2.next, null);
    assert(!JSON.stringify([p1, p2]).includes(w.base.replace(/\\/g, '\\\\')) && !JSON.stringify([p1, p2]).includes(w.base), 'no absolute path in the answer');
    assert.throws(() => desk.openProject('없는 이름'), /no project named/);
  });
  await t('names go through names.checkName: device · ADS · dots · bidi · reserved · too long are refused and nothing is written', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const before = tree(w.base);
    for (const bad of ['CON', 'nul.txt', 'P1:evil', 'x.', '..', '.hidden', 'a\u202Eb', '02_검토대상', 'a/b', 'a\\b', 'x'.repeat(61), ' lead', 'COM1']) {
      assert.throws(() => desk.newCase(bad, 'roof-purlin', () => '{}'), (e) => e instanceof Error, `newCase(${JSON.stringify(bad)})`);
      assert.throws(() => desk.openProject(bad, { create: true }), (e) => e instanceof Error, `openProject(${JSON.stringify(bad)})`);
    }
    assert.deepStrictEqual(changed(before, tree(w.base)), [], 'nothing was written');
  });

  // ── 검토 대상 · 열기 · 저장 ────────────────────────────────────────
  await t('new_case writes the .csd (wx) with the record key and a create line; a second one with the same name is refused', () => {
    const w = world(); const desk = w.make();
    const s = desk.openProject('P', { create: true });
    w.ctxRef.ctx = CX.cleanContext({ kind: 'ai', client: 'claude-ai/0.12', requestId: 'r-1' });
    const c = desk.newCase('퍼린 P1', 'roof-purlin', (record) => csd(record));
    w.ctxRef.ctx = undefined;
    assert.strictEqual(c.file, '02_검토대상/퍼린 P1.csd');
    const j = JSON.parse(fs.readFileSync(c.abs, 'utf8'));
    assert.deepStrictEqual(j.record, { caseId: c.caseId, projectId: s.projectId });
    const list = desk.listCases();
    assert.deepStrictEqual(list.cases.map((x) => [x.name, x.kind, x.caseId]), [['퍼린 P1', 'roof-purlin', c.caseId]]);
    assert.strictEqual(list.cases[0].index.section, 'lippedz', 'index rebuilt from the .csd when there is no index file');
    assert.throws(() => desk.newCase('퍼린 p1', 'roof-purlin', (r) => csd(r)), /EEXIST|exists/i);
    const lines = new L.RecordLog({ rootReal: fs.realpathSync.native(path.join(w.root, 'P')), projectId: s.projectId, spec: CS.CASES_SPEC, host: 'h' })
      .read(W.readTrust(w.keyDir).store).lines;
    assert.deepStrictEqual(lines.map((l) => [l.event, l.actor.kind, l.actor.client, l.status]), [['create', 'ai', 'claude-ai/0.12', 'ok']]);
  });
  await t('after open: opened line + lock; status shows the case; recordKey; after save: saved line, index, snapshot; reopen is not external', () => {
    const w = world(); const desk = w.make();
    const s = desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const bytes = fs.readFileSync(c.abs);
    const o = desk.afterOpen(c.abs, bytes, { record: JSON.parse(bytes).record });
    assert.deepStrictEqual([o.inProject, o.readOnly, o.wrote, o.case.caseId], [true, false, ['opened'], c.caseId]);
    assert(fs.existsSync(path.join(w.root, 'P', '.stcfsd', 'locks', `${c.caseId}.lock`)), 'lock file');
    assert.deepStrictEqual(desk.recordKey(c.abs), { caseId: c.caseId, projectId: s.projectId });
    assert.strictEqual(desk.status().case.name, 'P1');
    assert.deepStrictEqual(desk.beforeSave(c.abs), { ok: true, inProject: true });
    const next = Buffer.from(csd(desk.recordKey(), { designResult: { pass: false, utilization: 1.08 } }));
    fs.writeFileSync(c.abs, next);                    // 패널이 쓴다
    const saved = desk.afterSave(c.abs, next, { contentFp: 'sha256:' + 'c'.repeat(64), snapshot: { model: { a: 1 } } });
    assert(saved && /^[0-9a-f]{64}$/.test(saved.fileSha) && /^[0-9a-f]{64}$/.test(saved.snapshot));
    const list = desk.listCases();
    assert.deepStrictEqual([list.cases[0].index.maxRatio, list.cases[0].index.pass], [1.08, false], 'index written on save');
    desk.closeCase();
    assert(!fs.existsSync(path.join(w.root, 'P', '.stcfsd', 'locks', `${c.caseId}.lock`)), 'lock released');
    const o2 = desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    assert.deepStrictEqual(o2.wrote, ['opened'], 'the saved bytes are what was last saved — not external');
  });
  await t('⚔ a .csd changed outside is not saved (beforeSave refuses) and the next open writes an external line', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    fs.writeFileSync(c.abs, csd(null, { touched: 'by someone else' }));   // 밖에서 바뀜
    const r = desk.beforeSave(c.abs);
    assert.strictEqual(r.ok, false); assert.strictEqual(r.reason, 'changed-outside');
    fs.unlinkSync(c.abs);
    assert.strictEqual(desk.beforeSave(c.abs).reason, 'missing');
    fs.writeFileSync(c.abs, csd(null, { touched: 2 }));
    desk.closeCase();
    const o = desk.afterOpen(c.abs, fs.readFileSync(c.abs), { contentFp: 'sha256:' + 'd'.repeat(64) });
    assert.deepStrictEqual(o.wrote, ['opened', 'external']);
    assert(desk.caseStatus().externalSinceSave === true || desk.caseStatus().externalSinceSave === false);
  });
  await t('an unregistered .csd in 02_검토대상 is discovered once; a .csd elsewhere in the project and outside any project write nothing', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const f = path.join(dir, '02_검토대상', 'G2.csd'); fs.writeFileSync(f, csd(null));
    const o = desk.afterOpen(f, fs.readFileSync(f));
    assert.deepStrictEqual(o.wrote, ['discovered', 'opened']);
    desk.closeCase();
    assert.deepStrictEqual(desk.afterOpen(f, fs.readFileSync(f)).wrote, ['opened'], 'registered now');
    const before = tree(w.base);
    const other = path.join(dir, '03_계산서', 'x.csd'); fs.writeFileSync(other, csd(null));
    const before2 = tree(w.base);
    const o2 = desk.afterOpen(other, fs.readFileSync(other));
    assert.deepStrictEqual([o2.readOnly, o2.readOnlyReason, o2.wrote], [true, 'not-a-case-file', []]);
    const outside = path.join(w.base, 'loose.csd'); fs.writeFileSync(outside, csd(null));
    const before3 = tree(w.base);
    const o3 = desk.afterOpen(outside, fs.readFileSync(outside));
    assert.deepStrictEqual([o3.inProject, o3.wrote, desk.status().inProject], [false, [], false]);
    { const ch = changed(before3, tree(w.base)).filter((k) => !/.(lock|owner)$/.test(k)); assert.deepStrictEqual(ch, [], 'outside a project: nothing written (leaving the project only releases our own lock and stream markers) ' + JSON.stringify(ch)); }
    assert.strictEqual(desk.onRun('member_design', '{}', { pass: true }), null, 'no run line outside a project');
    void before; void before2;
  });

  // ── 실행 이력 · 사본 ─────────────────────────────────────────────
  await t('onRun: run line with request · result fingerprints, engine id, blob + snapshot; the blob reads back; actor from the context', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    const result = { pass: false, utilization: 1.0845, design_checks: [{ id: 'member.bending_shear', verdict: 'fail', ratio: 1.0845, governs: true, location: { region: 'lap-1', check_point: 'M_max' } }],
      regions: [{ result: { design_checks: [{ id: 'member.flexure.local', verdict: 'fail', ratio: 1.02 }] } }] };
    w.ctxRef.ctx = CX.cleanContext({ kind: 'ai', client: 'claude-ai/0.12', requestId: 'r-7', tool: 'design_purlin', reason: 'x\u0007y' });
    const r1 = desk.onRun('member_design', '{"Fy":55}', result, { model: { node: [] }, caseState: { inputs: { fy: 55 } }, caseRev: 4, ms: 812 });
    w.ctxRef.ctx = CX.cleanContext({ kind: 'screen' });
    desk.onRun('load_analysis', '{"x":1}', { pass: null });
    w.ctxRef.ctx = undefined;
    desk.onRun('validation', '{}', { error: 'engine said no' });
    assert.throws(() => desk.onRun('nonsense', '{}', {}), /unknown run kind/);
    const runs = desk.runsOf();
    assert.deepStrictEqual(runs.map((r) => [r.kind, r.actor, r.client, r.status]),
      [['member_design', 'ai', 'claude-ai/0.12', 'ok'], ['load_analysis', 'person', null, 'ok'], ['validation', 'program', null, 'failed']]);
    const m = runs[0];
    assert.deepStrictEqual([m.engineId, m.caseRev, m.ms, m.summary.pass, m.summary.maxRatio, m.summary.counts.fail, m.summary.governing[0].id, m.summary.regions],
      [ENGINE, 4, 812, false, 1.0845, 2, 'member.bending_shear', 1]);
    assert(/^sha256:/.test(m.requestFp) && /^sha256:/.test(m.resultFp) && /^sha256:/.test(m.modelFp) && /^sha256:/.test(m.caseFp));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const g = B.getBlob(dir, r1.blob);
    assert(g.ok); assert.deepStrictEqual(g.value, JSON.parse(JSON.stringify(result)));
    assert(B.getBlob(dir, r1.snapshot).ok);
    assert.strictEqual(runs[2].error, 'engine said no');
  });
  await t('⚔ a run copy with a wrong hash, a truncated gzip or a gzip bomb reads as damaged / too large — never as a value', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const real = B.putBlob(dir, { a: 1 });
    const file = B.blobPath(dir, real.sha256);
    const fake = 'f'.repeat(64);
    fs.mkdirSync(path.dirname(B.blobPath(dir, fake)), { recursive: true });
    fs.copyFileSync(file, B.blobPath(dir, fake));                 // 이름과 내용이 다르다
    assert.deepStrictEqual(B.getBlob(dir, fake), { ok: false, error: 'damaged' });
    fs.writeFileSync(file, fs.readFileSync(file).subarray(0, 10));
    assert.deepStrictEqual(B.getBlob(dir, real.sha256), { ok: false, error: 'damaged' });
    const zlib = require('zlib');
    const bomb = zlib.gzipSync(Buffer.alloc(70 * 1024 * 1024, 0x20));
    const bname = 'e'.repeat(64);
    fs.mkdirSync(path.dirname(B.blobPath(dir, bname)), { recursive: true });
    fs.writeFileSync(B.blobPath(dir, bname), bomb);
    assert.deepStrictEqual(B.getBlob(dir, bname), { ok: false, error: 'too large' });
    assert.deepStrictEqual(B.getBlob(dir, '0'.repeat(64)), { ok: false, error: 'missing' });
    assert.deepStrictEqual(B.getBlob(dir, '../x'), { ok: false, error: 'unreadable' });
  });
  await t('get_case_status data: match · differs · stale · none · other-engine per result kind, runs detail, record health', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    const F = rec('fp');
    const A = { pass: true, utilization: 0.5 }, Bv = { pass: true, utilization: 0.6 };
    desk.onRun('member_design', '{}', A); desk.onRun('load_analysis', '{}', Bv); desk.onRun('lap', '{}', A);
    const s = desk.caseStatus({ detail: 'runs', current: {
      member_design: { resultFp: F.resultFp(A) }, load_analysis: { resultFp: F.resultFp(A) }, lap: { resultFp: F.resultFp(A), stale: true },
      buckling_analysis: { resultFp: F.resultFp(A) } } });
    assert.deepStrictEqual([s.results.member_design.state, s.results.load_analysis.state, s.results.lap.state, s.results.buckling_analysis.state],
      ['match', 'differs', 'stale', 'none']);
    assert.strictEqual(s.runs.length, 3);
    assert.deepStrictEqual(s.records, { unverified: 0, untrusted: 0, broken: 0, chainBreaks: 0, shrunk: 0, readOnly: false, untrustedDamage: 0 });
    w.setEngine(ENGINE2);
    assert.strictEqual(desk.caseStatus({ current: { member_design: { resultFp: F.resultFp(A) } } }).results.member_design.state, 'other-engine');
    assert(!JSON.stringify(s).includes(w.base), 'no absolute path in the status');
  });

  // ── 잠금 · 두 인스턴스 ───────────────────────────────────────────
  await t('two instances (same PC, live pid): the second opens read-only and writes nothing; after the first closes it holds the lock', () => {
    const w = world(); const A = w.make({ pid: 1001, pidAlive: () => true }); const Bd = w.make({ pid: 1002, pidAlive: () => true });
    A.openProject('P', { create: true });
    const c = A.newCase('P1', 'roof-purlin', (r) => csd(r));
    A.afterOpen(c.abs, fs.readFileSync(c.abs));
    const before = tree(w.base);
    const o = Bd.afterOpen(c.abs, fs.readFileSync(c.abs));
    assert.deepStrictEqual([o.readOnly, o.readOnlyReason, o.wrote, o.lock.pid], [true, 'locked-here', [], 1001]);
    assert.strictEqual(Bd.beforeSave(c.abs).reason, 'read-only');
    assert.strictEqual(Bd.onRun('member_design', '{}', { pass: true }), null);
    assert.strictEqual(Bd.recordKey(), null);
    assert.deepStrictEqual(changed(before, tree(w.base)), [], 'the read-only instance wrote nothing');
    A.closeCase();
    assert.strictEqual(Bd.afterOpen(c.abs, fs.readFileSync(c.abs)).readOnly, false);
  });
  await t('my own lock left by a dead pid of this PC is taken over; my lock from another host is not', () => {
    const w = world(); const A = w.make({ pid: 2001, pidAlive: () => false });
    A.openProject('P', { create: true });
    const c = A.newCase('P1', 'roof-purlin', (r) => csd(r));
    A.afterOpen(c.abs, fs.readFileSync(c.abs));
    const Bd = w.make({ pid: 2002, pidAlive: () => false });
    assert.strictEqual(Bd.afterOpen(c.abs, fs.readFileSync(c.abs)).readOnly, false, 'the dead process lock is taken over');
    const Cd = w.make({ pid: 2003, host: 'other-pc', pidAlive: () => false });
    const o = Cd.afterOpen(c.abs, fs.readFileSync(c.abs));
    assert.deepStrictEqual([o.readOnly, o.readOnlyReason], [true, 'locked-elsewhere']);
  });
  await t('⚔ a planted lock (unsigned, garbage, another writer) makes the case read-only and nothing is written anywhere (project · key folder)', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const lock = path.join(dir, '.stcfsd', 'locks', `${c.caseId}.lock`);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const other = W.loadOrCreateWriter(path.join(w.base, 'otherkey'));
    for (const planted of [
      '{"not":"a lock"}', 'garbage',
      JSON.stringify({ schema: 'stcfsd-lock/1', caseId: c.caseId, writer: W.loadOrCreateWriter(w.keyDir).writerId, name: 'me?', host: 'test-host', pid: 999999, at: '2026-11-24T00:00:00Z' }),
      JSON.stringify({ schema: 'stcfsd-lock/1', caseId: c.caseId, writer: other.writerId, name: '김OO', host: 'PC-2', pid: 1, at: '2026-11-24T00:00:00Z', sig: 'x' }),
    ]) {
      fs.writeFileSync(lock, planted);
      const fresh = w.make();
      const before = tree(w.base);
      const o = fresh.afterOpen(c.abs, fs.readFileSync(c.abs));
      assert.strictEqual(o.readOnly, true, planted.slice(0, 30));
      assert.deepStrictEqual(o.wrote, []);
      assert.deepStrictEqual(changed(before, tree(w.base)), [], `nothing written for planted lock ${planted.slice(0, 30)}`);
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), planted, 'the planted lock is left as it is');
    }
  });
  await t('person.takeLock takes a planted lock over (person face); inside an MCP context every person function throws', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const lock = path.join(dir, '.stcfsd', 'locks', `${c.caseId}.lock`);
    fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.writeFileSync(lock, 'planted');
    assert.strictEqual(desk.afterOpen(c.abs, fs.readFileSync(c.abs)).readOnly, true);
    for (const kind of ['ai', 'screen']) {
      w.ctxRef.ctx = CX.cleanContext({ kind });
      assert.throws(() => desk.person.takeLock(c.caseId), D.PersonOnlyError, kind);
      assert.throws(() => desk.person.archive(c.caseId, true), D.PersonOnlyError);
      assert.throws(() => desk.person.openFolder(dir), D.PersonOnlyError);
      assert.throws(() => desk.person.createProject(w.root, 'X'), D.PersonOnlyError);
    }
    assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'planted');
    w.ctxRef.ctx = undefined;
    desk.person.takeLock(c.caseId);
    assert.strictEqual(desk.status().case.readOnly, false);
    assert.strictEqual(K.readLock(dir, c.caseId, W.loadOrCreateWriter(w.keyDir)).mine, true);
    desk.person.archive(c.caseId, true);
    assert.deepStrictEqual(desk.listCases().cases, [], 'archived cases are hidden');
    assert.strictEqual(desk.listCases({ includeArchived: true }).cases[0].archived, true);
    assert.throws(() => CX.toActor && desk.person.archive('cbad', true), /bad case id/);
    assert(Object.isFrozen(desk.person));
  });

  // ── 꾸민 프로젝트 폴더 ───────────────────────────────────────────
  await t('⚔ a crafted project folder (declaration with folder roles · absolute paths, foreign-signed lines, bad blob, planted lock, pre-made issue folder) opens without writing anywhere', () => {
    const w = world();
    const elsewhere = path.join(w.base, 'elsewhere'); fs.mkdirSync(elsewhere);
    const dir = path.join(w.root, 'Crafted'); fs.mkdirSync(dir);
    for (const f of ['01_원자료', '02_검토대상', '03_계산서', '04_발행본']) { fs.mkdirSync(path.join(dir, f)); }
    fs.writeFileSync(path.join(dir, 'stcfsd-project.json'), JSON.stringify({ schema: 'stcfsd-project/1', projectId: 'p' + 'a'.repeat(16), name: 'Crafted',
      createdAt: 'x', folders: { cases: elsewhere, reports: 'C:\\Windows\\System32' }, records: elsewhere, keyDir: elsewhere }));
    // 남의 열쇠로 서명한 줄(진짜 줄 파일 모양 — 다른 작성자)
    const foreignKey = path.join(w.base, 'foreign');
    const fw = W.loadOrCreateWriter(foreignKey);
    const flog = new L.RecordLog({ rootReal: fs.realpathSync.native(dir), projectId: 'p' + 'a'.repeat(16), spec: CS.CASES_SPEC, host: 'PC-9', keyDir: foreignKey });
    flog.open(fw);
    const cid = 'c' + 'b'.repeat(16);
    flog.append({ id: 'case-1', event: 'create', actor: { kind: 'ai' }, body: { caseId: cid, name: 'P1', file: '02_검토대상/P1.csd', kind: 'roof-purlin' } });
    flog.close();
    fs.writeFileSync(path.join(dir, '02_검토대상', 'P1.csd'), csd({ caseId: cid, projectId: 'p' + 'a'.repeat(16) }));
    // 해시가 틀린 사본 · 심은 잠금 · 미리 만든 발행 폴더
    const bdir = path.join(dir, '.stcfsd', 'blobs', 'ab'); fs.mkdirSync(bdir, { recursive: true });
    fs.writeFileSync(path.join(bdir, 'ab' + '0'.repeat(62) + '.json.gz'), require('zlib').gzipSync('{"a":1}'));
    fs.mkdirSync(path.join(dir, '.stcfsd', 'locks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.stcfsd', 'locks', `${cid}.lock`), JSON.stringify({ schema: 'stcfsd-lock/1', caseId: cid, writer: fw.writerId, name: 'x', host: 'PC-9', pid: 1, at: 'x' }));
    fs.mkdirSync(path.join(dir, '04_발행본', 'P1', 'R0'), { recursive: true });
    fs.writeFileSync(path.join(dir, '04_발행본', 'P1', 'R0', 'P1.csd'), csd(null));
    const desk = w.make();
    const before = tree(w.base);
    const s = desk.openProject('Crafted');
    assert(s.warnings.some((x) => /folders/.test(x)) && s.warnings.some((x) => /keyDir/.test(x)), 'unknown declaration keys are named');
    const list = desk.listCases();
    assert.deepStrictEqual(list.cases, [], 'a case created by an untrusted writer is not counted');
    assert.deepStrictEqual(list.unregistered.map((u) => u.name), ['P1'], 'unregistered ' + JSON.stringify(list.unregistered));
    const st = desk.caseStatus();
    assert.strictEqual(st.records.untrusted + st.records.unverified, 1, 'the foreign line is not counted');
    const iss = path.join(dir, '04_발행본', 'P1', 'R0', 'P1.csd');
    const oi = desk.afterOpen(iss, fs.readFileSync(iss));
    assert.deepStrictEqual([oi.readOnly, oi.readOnlyReason, oi.wrote], [true, 'issued-copy', []], 'issued ' + JSON.stringify(oi));
    assert.deepStrictEqual(B.getBlob(fs.realpathSync.native(dir), 'ab' + '0'.repeat(62)), { ok: false, error: 'damaged' });
    // 프로젝트 열기 · 목록 · 상태 · 발행본 열기 · 사본 읽기: 어디에도 쓰지 않는다(프로젝트 · 선언이 가리키는 곳 · 열쇠 자리)
    assert.deepStrictEqual(changed(before, tree(w.base)), [], 'nothing was written anywhere ' + JSON.stringify(changed(before, tree(w.base))));
    // 대상을 사람이 열면: 그 줄은 남의 대상 id(믿지 않는 작성자)를 쓰지 않고 새 대상으로 — 쓰는 곳은 그 프로젝트의 .stcfsd 와 열쇠 자리뿐
    const o = desk.afterOpen(path.join(dir, '02_검토대상', 'P1.csd'), fs.readFileSync(path.join(dir, '02_검토대상', 'P1.csd')));
    assert.deepStrictEqual([o.readOnly, o.wrote], [false, ['discovered', 'opened']], 'case open ' + JSON.stringify(o));
    assert.notStrictEqual(o.case.caseId, cid, 'the untrusted case id is not adopted');
    assert(o.notices.length === 0 || o.notices.every((n) => typeof n === 'string'));
    desk.dispose();
    const where = changed(before, tree(w.base));
    const allowed = (k) => k.startsWith(path.join('projects', 'Crafted', '.stcfsd') + path.sep) || k.startsWith('key' + path.sep) || k === 'key/';
    assert.deepStrictEqual(where.filter((k) => !allowed(k)), [], 'only our own records under <project>/.stcfsd and the key folder ' + JSON.stringify(where));
    assert.deepStrictEqual(fs.readdirSync(elsewhere), [], 'nothing where the declaration points');
    assert.strictEqual(fs.readFileSync(path.join(dir, '.stcfsd', 'locks', `${cid}.lock`), 'utf8').includes('"pid":1'), true, 'the planted lock is untouched');
  });
  await t('⚔ a project inside a protected root is not listed, not opened, and a .csd in it opens read-only with nothing written', () => {
    const w0 = world();
    const prot = path.join(w0.base, 'protected'); fs.mkdirSync(prot);
    const desk0 = w0.make();
    desk0.person.createProject(prot, 'Inside');      // (사람이 만든 것처럼 — 아직 보호 폴더가 아니다)
    const c0 = desk0.newCase('P1', 'roof-purlin', (r) => csd(r));
    desk0.dispose();
    const w = { ...w0 };
    const desk = new D.RecordsDesk({ keyDir: w0.keyDir, roots: () => [prot], recentProjects: () => [path.join(prot, 'Inside')], protectedRoots: () => [prot],
      now: () => '2026-11-24T00:00:00.000Z', host: 'test-host', version: 'test', engineId: () => null });
    const before = tree(w.base);
    assert.deepStrictEqual(desk.listProjects().projects, []);
    assert.throws(() => desk.openProject('Inside'), /no project named|protected/);
    assert.throws(() => desk.person.openFolder(path.join(prot, 'Inside')), /protected/);
    assert.throws(() => desk.person.createProject(prot, 'New'), /protected/);
    const o = desk.afterOpen(c0.abs, fs.readFileSync(c0.abs));
    assert.deepStrictEqual([o.readOnly, o.readOnlyReason, o.wrote], [true, 'protected-folder', []]);
    assert.deepStrictEqual(changed(before, tree(w.base)), []);
  });
  await t('⚔ junction · link · hard link: a junctioned 02_검토대상 refuses new_case; a file through a junction or with two hard links opens read-only and is not saved', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const out = path.join(w.base, 'outside'); fs.mkdirSync(out);
    fs.rmdirSync(path.join(dir, '02_검토대상'));
    if (!tryLink(out, path.join(dir, '02_검토대상'), 'junction')) { return 'skip'; }
    assert.throws(() => desk.newCase('P1', 'roof-purlin', (r) => csd(r)), /link|junction/);
    assert.deepStrictEqual(fs.readdirSync(out), [], 'nothing written through the junction');
    fs.writeFileSync(path.join(out, 'J.csd'), csd(null));
    const before = tree(w.base);
    const oj = desk.afterOpen(path.join(dir, '02_검토대상', 'J.csd'), fs.readFileSync(path.join(out, 'J.csd')));
    assert.strictEqual(oj.readOnly, true);
    assert.deepStrictEqual(oj.wrote, []);
    assert.deepStrictEqual(changed(before, tree(w.base)), []);
    // 하드 링크
    fs.unlinkSync(path.join(dir, '02_검토대상'));
    fs.mkdirSync(path.join(dir, '02_검토대상'));
    const c = desk.newCase('H', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    try { fs.linkSync(c.abs, path.join(out, 'H-link.csd')); } catch (e) { if (e.code === 'EPERM') { return 'skip'; } throw e; }
    assert.strictEqual(desk.beforeSave(c.abs).reason, 'hard-link');
    desk.closeCase();
    assert.deepStrictEqual(desk.afterOpen(c.abs, fs.readFileSync(c.abs)).readOnlyReason, 'hard-link');
  });

  // ── 두 프로세스 ─────────────────────────────────────────────────
  await t('two processes write runs for two cases of one project with the same writer key — separate streams, every line verifies', async () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const a = desk.newCase('A', 'roof-purlin', (r) => csd(r));
    const b = desk.newCase('B', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(a.abs, fs.readFileSync(a.abs));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const child = cp.fork(path.join(__dirname, '_child_desk.js'), [dir, w.keyDir, 'B', '40'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const ready = await new Promise((res, rej) => { child.once('message', res); child.once('error', rej); });
    assert.strictEqual(ready.readOnly, false, 'the child holds case B');
    const doneP = new Promise((res) => child.on('message', (m) => { if (m.done) { res(m); } }));
    child.send('go');
    for (let i = 0; i < 40; i += 1) { desk.onRun('member_design', `{"parent":${i}}`, { pass: true, utilization: i / 100 }); }
    await doneP;
    await new Promise((res) => child.once('exit', res));
    const runsDir = path.join(dir, '.stcfsd', 'log', 'runs');
    const streams = fs.readdirSync(runsDir).filter((n) => n.endsWith('.jsonl'));
    assert.strictEqual(streams.length, 2, `two stream files (${streams.join(', ')})`);
    const all = new L.RecordLog({ rootReal: dir, projectId: desk.project.projectId, spec: rec('runs').RUNS_SPEC, host: 'test-host' })
      .read(W.readTrust(w.keyDir).store);
    // R4-3: 대상 · 종류마다 새 것 20 을 넘으면 사본 정리 줄(prune, program)이 따라 붙는다
    assert.strictEqual(all.lines.filter((l) => l.event === 'run').length, 80);
    assert(all.lines.filter((l) => l.event === 'prune').every((l) => l.actor.kind === 'program'), 'prune lines are the program\'s');
    assert(all.lines.every((l) => l.status === 'ok'), 'every line verifies');
    assert.deepStrictEqual([desk.runsOf(a.caseId).length, desk.runsOf(b.caseId).length], [40, 40]);
    assert.deepStrictEqual(all.stats.chainBreaks, []);
  });

  // ── 문맥 ────────────────────────────────────────────────────────
  await t('context: unknown kinds become ai, ids outside the form are dropped, reason is cleaned and capped; isMcpContext for ai · screen only', () => {
    assert.deepStrictEqual(CX.cleanContext({ kind: 'root', requestId: 'r 1', work: 'Q-3', source: '../x', reason: 'a\u0000b'.padEnd(400, 'z'), client: 'c'.repeat(100) }),
      { kind: 'ai', work: 'Q-3', reason: ('a b'.padEnd(400, 'z')).slice(0, 300), client: 'c'.repeat(80) });
    assert.deepStrictEqual(['ai', 'screen', 'person', 'program', undefined].map((k) => CX.isMcpContext(k ? { kind: k } : undefined)), [true, true, false, false, false]);
    assert.deepStrictEqual(CX.toActor({ kind: 'screen', client: 'ui' }), { kind: 'person', client: 'ui' });
    assert.deepStrictEqual(CX.toActor(undefined), { kind: 'program' });
  });
  // ── R1-3 이 바란 것(사람의 얼굴 · 읽기 전용 파일 · 색인) ─────────────────
  await t('R1-3: an issued copy shows as file_read_only in the status (project name, no case), nothing written', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const iss = path.join(dir, '04_발행본', 'P1', 'R0', 'P1.csd');
    fs.mkdirSync(path.dirname(iss), { recursive: true }); fs.copyFileSync(c.abs, iss);
    const fresh = w.make();
    const o = fresh.afterOpen(iss, fs.readFileSync(iss));
    assert.strictEqual(o.readOnlyReason, 'issued-copy');
    const st = fresh.status();
    assert.deepStrictEqual([st.inProject, st.project.name, st.project.readOnly, st.case, st.file_read_only.reason], [true, 'P', true, null, 'issued-copy']);
    assert(/issued copy/.test(st.file_read_only.detail));
    // 다른(보통) 파일을 열면 사라진다
    fresh.afterOpen(c.abs, fs.readFileSync(c.abs));
    assert.strictEqual(fresh.status().file_read_only, undefined);
  });
  await t('R1-3: person face — projects / current project with folder paths, writer name (default the host name, set once, kept), relink, allow overwrite; all throw in an MCP context', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const pr = desk.person.projects();
    assert(pr.length === 1 && pr[0].name === 'P' && pr[0].dir === dir && pr[0].open === true, JSON.stringify(pr));
    assert.deepStrictEqual(desk.person.currentProject(), { name: 'P', dir, readOnly: false });
    assert.strictEqual(desk.person.writerName(), 'Tester');
    assert.strictEqual(desk.person.setWriterName('  김설계  '), '김설계');
    assert.strictEqual(w.make().person.writerName(), '김설계', 'kept in the key folder');
    assert.throws(() => desk.person.setWriterName('   '), /writer name/);
    // relink: 파일을 옮긴 대상을 다시 잇는다(02 안 · 다른 대상의 파일은 거절)
    const moved = path.join(dir, '02_검토대상', 'P1 옮김.csd');
    fs.renameSync(c.abs, moved);
    assert.deepStrictEqual(desk.person.relink(c.caseId, moved), { caseId: c.caseId, file: '02_검토대상/P1 옮김.csd' });
    assert.strictEqual(desk.listCases().cases.find((x) => x.caseId === c.caseId).missing, false);
    const c2 = desk.newCase('P2', 'roof-purlin', (r) => csd(r));
    assert.throws(() => desk.person.relink(c.caseId, c2.abs), /belongs to the case/);
    const outside = path.join(dir, '03_계산서', 'x.csd'); fs.mkdirSync(path.dirname(outside), { recursive: true }); fs.writeFileSync(outside, csd(null));
    assert.throws(() => desk.person.relink(c.caseId, outside), /02_검토대상/);
    // 덮어쓰기: 밖에서 바뀐 파일 — 거절 → 사람이 허락 → 저장 대조를 지금 파일로(external 줄)
    desk.afterOpen(moved, fs.readFileSync(moved));
    fs.writeFileSync(moved, csd({ caseId: c.caseId, projectId: P.readDeclaration(dir).decl.projectId }, { note: 'outside' }));
    assert.strictEqual(desk.beforeSave(moved).reason, 'changed-outside');
    desk.person.allowOverwrite();
    assert.strictEqual(desk.beforeSave(moved).ok, true);
    w.ctxRef.ctx = { kind: 'screen' };
    for (const fn of ['projects', 'currentProject', 'writerName', 'allowOverwrite']) { assert.throws(() => desk.person[fn](), /person-only/, fn); }
    assert.throws(() => desk.person.setWriterName('AI'), /person-only/);
    assert.throws(() => desk.person.relink(c.caseId, moved), /person-only/);
    w.ctxRef.ctx = undefined;
    desk.dispose();
  });
  await t('R1-3: the case index carries the result kinds and a small outline (numbers only, bounded) — a crafted index is cut to what can be drawn', () => {
    const IX = rec('caseIndex');
    const node = [], elem = [];
    for (let i = 0; i < 300; i += 1) { node.push([i + 1, Math.cos(i / 50) * 4, Math.sin(i / 50) * 4, 1, 1, 1, 1, 0]); }
    for (let i = 0; i < 299; i += 1) { elem.push([i + 1, i + 1, i + 2, 0.06, 100]); }
    const s1 = IX.summarizeCsd(Buffer.from(JSON.stringify({ version: '1.4', model: { node, elem }, analysisResult: { curve: [] }, designResult: { utilization: 0.5, pass: true } })));
    assert.deepStrictEqual(s1.results, ['buckling_analysis', 'member_design']);
    const pts = s1.outline.paths.reduce((n, p) => n + p.length / 2, 0);
    assert(pts <= IX.OUTLINE_MAX_POINTS + 2 && s1.outline.paths.every((p) => p.every((v) => Number.isInteger(v) && v >= 0 && v <= 1000)), 'bounded integers ' + pts);
    assert(JSON.stringify(s1.outline).length < 1200, 'a few hundred bytes: ' + JSON.stringify(s1.outline).length);
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const sha = require('crypto').createHash('sha256').update(fs.readFileSync(c.abs)).digest('hex');
    const ixFile = IX.indexPath(dir, c.caseId);
    fs.mkdirSync(path.dirname(ixFile), { recursive: true });
    for (const outline of [{ paths: [['<script>', 1, 2, 3]], aspect: 1 }, { paths: [[0, 0, 5000, 1]], aspect: 1 }, { paths: Array(50).fill([0, 0, 1, 1]), aspect: 1 },
      { paths: [[0, 0, 1.5, 1]], aspect: 1 }, { paths: [Array(1000).fill(1)], aspect: 1 }]) {
      fs.writeFileSync(ixFile, JSON.stringify({ schema: IX.INDEX_SCHEMA, caseId: c.caseId, csdSha: sha, results: ['buckling_analysis', 'evil'], outline }));
      const r = IX.readIndex(dir, c.caseId, sha);
      assert.strictEqual(r.outline, null, 'crafted outline refused: ' + JSON.stringify(outline).slice(0, 60));
      assert.deepStrictEqual(r.results, ['buckling_analysis'], 'unknown result kinds dropped');
    }
    desk.dispose();
  });
  await t('the desk never picks a user folder itself (no LOCALAPPDATA / APPDATA / homedir in desk.ts and its new modules)', () => {
    for (const f of ['desk', 'locks', 'blobs', 'cases', 'runs', 'caseIndex', 'context']) {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'records', `${f}.ts`), 'utf8');
      assert(!/LOCALAPPDATA|APPDATA|homedir\(|defaultKeyDir/.test(src), `${f}.ts`);
    }
    void P;
  });
  // ── V9b: 독립 프로그램의 「원자료 열기」 — 01_원자료 안의 진짜 경로 · 등록한 해시 · 문서 종류일 때만 경로, 아니면 code ──
  await t('source open path: inside 01_원자료, the registered bytes and a viewer type only — otherwise a coded refusal; person-only', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const srcDir = path.join(dir, '01_원자료');
    fs.writeFileSync(path.join(srcDir, 'dwg.pdf'), '%PDF-1.4 drawing');
    fs.writeFileSync(path.join(srcDir, 'run.bat'), 'echo hi');
    w.ctxRef.ctx = CX.cleanContext({ kind: 'ai', requestId: 'r-1', tool: 'sources' });
    const s1 = desk.writeSource('register', { path: '01_원자료/dwg.pdf' });
    const s2 = desk.writeSource('register', { path: '01_원자료/run.bat' });
    assert.throws(() => desk.person.sourceToOpen(s1.item), /person-only/);
    w.ctxRef.ctx = undefined;
    const ok = desk.person.sourceToOpen(s1.item);
    assert(ok.path === fs.realpathSync.native(path.join(srcDir, 'dwg.pdf')) && ok.openable === true && ok.state === 'same' && ok.why === null && ok.ext === 'pdf', 'the real path of a registered pdf: ' + JSON.stringify(ok));
    const ex = desk.person.sourceToOpen(s2.item); assert(ex.path === null && ex.openable === false && ex.why === 'host.source.type', 'an executable type: no path, coded why ' + JSON.stringify(ex));
    fs.appendFileSync(path.join(srcDir, 'dwg.pdf'), 'x');
    const ch = desk.person.sourceToOpen(s1.item); assert(ch.path === null && ch.state === 'changed' && ch.why === 'host.source.changed', 'changed bytes: no path ' + JSON.stringify(ch));
    fs.unlinkSync(path.join(srcDir, 'dwg.pdf'));
    const mi = desk.person.sourceToOpen(s1.item); assert(mi.path === null && mi.state === 'missing' && mi.why === 'host.source.missing', 'missing ' + JSON.stringify(mi));
    assert.strictEqual(desk.person.sourceToOpen('S-99').why, 'host.source.missing');
  });
  // ── V9b-04: 손상된 기록 — 믿지 않는 작성자의 것은 막지 않고, 믿는 작성자의 것은 사람이 격리 · 받아들임으로 빠져나온다 ──
  await t('V9b-04 damaged records: an untrusted or planted stream does not block; own damage is quarantined or a restored shrink accepted by the person, with a signed line', () => {
    const w = world(); const desk = w.make();
    desk.openProject('P', { create: true });
    const c = desk.newCase('P1', 'roof-purlin', (r) => csd(r));
    desk.afterOpen(c.abs, fs.readFileSync(c.abs));
    for (let i = 0; i < 3; i += 1) { desk.onRun('member_design', `{"i":${i}}`, { pass: true, utilization: 0.5 }); }
    const dir = fs.realpathSync.native(path.join(w.root, 'P'));
    const runsDir = path.join(dir, '.stcfsd', 'log', 'runs');
    const health = () => desk.caseStatus().records;
    assert.deepStrictEqual([health().broken, health().chainBreaks, health().shrunk], [0, 0, 0], 'clean');
    const caseLog = () => new L.RecordLog({ rootReal: dir, projectId: desk.status().project.projectId, spec: CS.CASES_SPEC, host: 'test-host', keyDir: w.keyDir })
      .read(W.readTrust(w.keyDir).store, new Map(), undefined, { recordSeen: false });
    // ⚔ 한 줄짜리 쓰레기 · 서명 없는 줄 파일(모르는 작성자 이름) — 막지 않는다(따로 보인다)
    const planted = path.join(runsDir, 'w' + 'q'.repeat(20) + '.jsonl');
    fs.writeFileSync(planted, 'not json at all\n{"schema":"stcfsd-runs/1"}\n');
    let h = health();
    assert(h.broken === 0 && h.chainBreaks === 0 && h.untrustedDamage >= 1, 'a planted stream is not damage that blocks: ' + JSON.stringify(h));
    assert.deepStrictEqual(desk.person.recordsDamage(), [], 'and is not offered for quarantine (not a trusted writer)');
    fs.unlinkSync(planted);
    // 자기 줄 파일의 가운데를 깬다 → 막는다 → 사람이 격리 → 풀린다, 서명된 줄과 옮긴 파일의 해시
    const own = fs.readdirSync(runsDir).find((n) => /^w[a-z2-7]{20}\.jsonl$/.test(n));
    const ownFile = path.join(runsDir, own);
    const keep = fs.readFileSync(ownFile);
    const lines = keep.toString('utf8').split('\n');
    fs.writeFileSync(ownFile, [lines[0], '{"broken": tru', ...lines.slice(1)].join('\n'));
    h = health();
    assert(h.broken >= 1, 'own damage blocks: ' + JSON.stringify(h));
    const dmg = desk.person.recordsDamage();
    assert(dmg.length === 1 && dmg[0].type === 'runs' && dmg[0].own === true && dmg[0].broken >= 1, 'listed for the person: ' + JSON.stringify(dmg));
    w.ctxRef.ctx = CX.cleanContext({ kind: 'ai', requestId: 'r-1', tool: 'x' });
    assert.throws(() => desk.person.resolveDamage({ type: 'runs', stream: dmg[0].stream, action: 'quarantine' }), /person-only/, 'person-only');
    w.ctxRef.ctx = undefined;
    const q = desk.person.resolveDamage({ type: 'runs', stream: dmg[0].stream, action: 'quarantine' });
    assert(q.files === 1 && /^\.stcfsd\/quarantine\/runs\//.test(q.movedTo) && fs.existsSync(path.join(dir, ...q.movedTo.split('/'), own)) && !fs.existsSync(ownFile), 'moved aside: ' + JSON.stringify(q));
    h = health();
    assert(h.broken === 0 && h.shrunk === 0 && h.chainBreaks === 0, 'unblocked after the quarantine: ' + JSON.stringify(h));
    const caseLines = caseLog().lines.filter((l) => l.event === 'quarantine');
    assert(caseLines.length === 1 && caseLines[0].actor.kind === 'person' && caseLines[0].body.files[0].sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, ...q.movedTo.split('/'), own))).digest('hex'),
      'a signed person line says what was set aside: ' + JSON.stringify(caseLines[0] && caseLines[0].body));
    // 다시 쓰면 새 줄 파일 — 줄어듦으로 보이지 않는다
    desk.onRun('member_design', '{"i":9}', { pass: true, utilization: 0.4 });
    assert.strictEqual(health().shrunk, 0, 'the new stream is not «shrunk»');
    // 백업에서 되살린 줄어든 자기 줄 파일 → 막는다 → 받아들임
    const own2 = fs.readdirSync(runsDir).find((n) => /^w[a-z2-7]{20}\.jsonl$/.test(n));
    desk.onRun('member_design', '{"i":10}', { pass: true, utilization: 0.4 });
    const full = fs.readFileSync(path.join(runsDir, own2), 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(path.join(runsDir, own2), full.slice(0, -1).join('\n') + '\n');
    assert(health().shrunk >= 1, 'a restored (shorter) stream reads shrunk');
    const d2 = desk.person.recordsDamage().find((d) => d.shrunk);
    assert.throws(() => desk.person.resolveDamage({ type: 'cases', stream: d2.stream, action: 'accept' }), /not damaged/);
    const a = desk.person.resolveDamage({ type: d2.type, stream: d2.stream, action: 'accept' });
    assert(a.action === 'accept' && health().shrunk === 0, 'accepted: ' + JSON.stringify(health()));
    assert(caseLog().lines.some((l) => l.event === 'accept-shrunk' && l.actor.kind === 'person' && l.body.expectedSeq > l.body.foundSeq), 'signed accept line');
  });
  return done();
}

module.exports = { run };
