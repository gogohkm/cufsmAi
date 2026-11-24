/* global require, module, process, __dirname, setImmediate */
// R1-1 — 줄 파일: 서명 · 사슬 · 반쯤 쓴 줄 · 깨진 줄 · 바뀐 서명 · 지운 줄 · 잘린 끝 · 큰 줄 · 높은 판 · 모르는 사건 ·
// 남의 열쇠 · 링크 · 조각 돌리기 · 두 프로세스가 같은 작성자로.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { rec, tmp, tryLink, suite } = require('./_harness');

async function run() {
  const { t, done } = suite('records_log');
  const C = rec('canonical'), W = rec('writer'), L = rec('log'), P = rec('project'), WK = rec('work');
  const PID = 'pabcdefghijklmnop';

  function setup(limits) {
    const root = tmp();
    const keyDir = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(keyDir);
    W.trustSelf(keyDir, w, 'me', 'now');
    const mk = (spec = WK.WORK_SPEC, extra = {}) => new L.RecordLog({ rootReal: root, projectId: PID, spec, host: 'test-host', keyDir, limits, ...extra });
    const log = mk();
    log.open(w);
    const trust = () => W.readTrust(keyDir).store;
    return { root, keyDir, w, mk, log, trust };
  }
  const add = (log, n, extra = {}) => log.append({ id: `R-${n}`, event: 'add', actor: { kind: 'ai', client: 'claude' },
    body: { item: `R-${n}`, kind: 'report', caseId: null, title: `보고 ${n}`, body: '', refs: [], items: [], ...extra } });
  const file = (s) => path.join(s.root, '.stcfsd', 'log', 'work', `${s.w.writerId}.jsonl`);
  const lines = (s) => fs.readFileSync(file(s), 'utf8').split('\n').filter(Boolean);
  const put = (s, ls) => fs.writeFileSync(file(s), ls.join('\n') + '\n');

  await t('three lines read back verified, chained, in order, with only known body keys', () => {
    const s = setup();
    for (let i = 1; i <= 3; i += 1) { add(s.log, i); }
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [2, 'ok'], [3, 'ok']]);
    assert.strictEqual(r.lines[0].prev, null);
    assert.strictEqual(r.lines[1].prev, 'sha256:' + C.sha256Hex(lines(s)[0]));
    assert.deepStrictEqual(r.stats.chainBreaks, []);
    assert(r.lines.every(L.countable));
  });
  await t('half-written last line: skipped and counted; the next write starts on a new line and the chain continues', () => {
    const s = setup();
    add(s.log, 1); add(s.log, 2);
    fs.appendFileSync(file(s), '{"schema":"stcfsd-rec/work/1","seq":3,"id":"R-3","ev');
    let r = s.log.read(s.trust());
    assert.strictEqual(r.stats.broken, 1);
    assert.strictEqual(r.lines.length, 2);
    add(s.log, 3);
    r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [2, 'ok'], [3, 'ok']]);
    assert.deepStrictEqual(r.stats.chainBreaks, []);
  });
  await t('corrupted middle line: only that line is lost — a gap is reported and the next verified line counts (V7-20)', () => {
    const s = setup();
    for (let i = 1; i <= 3; i += 1) { add(s.log, i); }
    const ls = lines(s);
    ls[1] = ls[1].replace('보고 2', '보고 X');
    put(s, ls);
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [2, 'unverified'], [3, 'ok']]);
    assert.deepStrictEqual(r.stats.chainBreaks, [{ stream: s.w.writerId, atSeq: 3, afterSeq: 1 }]);
    assert.strictEqual(r.lines.filter(L.countable).length, 2);
  });
  await t('replaced signature (taken from another line) does not verify', () => {
    const s = setup();
    add(s.log, 1); add(s.log, 2);
    const ls = lines(s).map((x) => JSON.parse(x));
    ls[1].sig = ls[0].sig;
    put(s, ls.map((x) => C.canonicalJson(x)));
    const r = s.log.read(s.trust());
    assert.strictEqual(r.lines[1].status, 'unverified');
    assert.strictEqual(r.stats.unverified, 1);
  });
  await t('deleted middle line breaks the chain; a truncated tail or a deleted file is reported as shrunk (seen.json)', () => {
    const s = setup();
    for (let i = 1; i <= 4; i += 1) { add(s.log, i); }
    const ls = lines(s);
    put(s, [ls[0], ls[2], ls[3]]);
    let r = s.log.read(s.trust());
    assert.deepStrictEqual(r.stats.chainBreaks, [{ stream: s.w.writerId, atSeq: 3, afterSeq: 1 }]);
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [3, 'ok'], [4, 'ok']]);
    put(s, ls.slice(0, 3));
    r = s.log.read(s.trust());
    assert.deepStrictEqual(r.stats.chainBreaks, []);
    assert.deepStrictEqual(r.stats.shrunk, [{ stream: s.w.writerId, expectedSeq: 4, foundSeq: 3 }]);
    fs.unlinkSync(file(s));
    r = s.log.read(s.trust());
    assert.deepStrictEqual(r.stats.shrunk, [{ stream: s.w.writerId, expectedSeq: 4, foundSeq: 0 }]);
  });
  await t('a re-signed rewrite with the same length is still caught by seen.json (hash at the last seq differs)', () => {
    const s = setup();
    add(s.log, 1); add(s.log, 2);
    const ls = lines(s);
    put(s, [ls[0]]);
    s.log.close(); s.log.open(s.w);
    s.log.read(s.trust());
    // 다른 몸으로 2 를 다시 쓴다(같은 열쇠 — 프로그램이 아닌 손이 줄을 바꿔 친 것처럼)
    const r0 = JSON.parse(ls[1]);
    const v = { ...r0, title: '바뀐 보고' };
    delete v.sig;
    const forged = C.canonicalJson({ ...v, sig: { w: s.w.writerId, s: s.w.sign(W.signingBytes(v)) } });
    put(s, [ls[0], forged]);
    const r = s.log.read(s.trust());
    assert.strictEqual(r.lines[1].status, 'ok');
    assert.deepStrictEqual(r.stats.shrunk, [{ stream: s.w.writerId, expectedSeq: 2, foundSeq: 2 }]);
  });
  await t('oversized line: refused on write (file unchanged), counted on read', () => {
    const s = setup();
    add(s.log, 1);
    const before = fs.readFileSync(file(s));
    assert.throws(() => add(s.log, 2, { body: '가'.repeat(8000), items: Array.from({ length: 50 }, () => ({ text: '나'.repeat(300), status: 'done', refs: [] })) }), /not truncated|limit/);
    assert(before.equals(fs.readFileSync(file(s))));
    fs.appendFileSync(file(s), '{"pad":"' + 'z'.repeat(70 * 1024) + '"}\n');
    const r = s.log.read(s.trust());
    assert.strictEqual(r.stats.oversized, 1);
    assert.strictEqual(r.lines.length, 1);
  });
  /** 서명 · 사슬을 맞춘 줄을 손으로 덧붙인다(높은 판 · 모르는 사건) */
  function appendRaw(s, patch) {
    const ls = lines(s);
    const last = JSON.parse(ls[ls.length - 1]);
    const v = { schema: 'stcfsd-rec/work/1', seq: last.seq + 1, id: 'R-90', event: 'add', at: '2026-11-24T00:00:00Z', project: PID,
      stream: s.w.writerId, actor: { kind: 'ai' }, prev: 'sha256:' + C.sha256Hex(ls[ls.length - 1]), item: 'R-90', kind: 'report', title: 'raw', ...patch };
    fs.appendFileSync(file(s), C.canonicalJson({ ...v, sig: { w: s.w.writerId, s: s.w.sign(W.signingBytes(v)) } }) + '\n');
  }
  await t('higher major version: that record type becomes read-only; the chain still holds', () => {
    const s = setup();
    add(s.log, 1);
    appendRaw(s, { schema: 'stcfsd-rec/work/2' });
    const r = s.log.read(s.trust());
    assert(r.readOnly && r.stats.newer === 1 && r.lines.length === 1);
    assert.deepStrictEqual(r.stats.chainBreaks, []);
  });
  await t('unknown event: skipped and counted; refused on write', () => {
    const s = setup();
    add(s.log, 1);
    appendRaw(s, { event: 'frobnicate' });
    add(s.log, 2);
    const r = s.log.read(s.trust());
    assert.strictEqual(r.stats.unknownEvent, 1);
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [3, 'ok']]);
    assert.throws(() => s.log.append({ id: 'R-5', event: 'frobnicate', actor: { kind: 'ai' }, body: {} }), /unknown event/);
  });
  await t('body may not carry envelope keys; a body that does not match the type is refused on write', () => {
    const s = setup();
    for (const k of ['seq', 'sig', 'prev', 'actor', 'project']) {
      assert.throws(() => s.log.append({ id: 'R-1', event: 'add', actor: { kind: 'ai' }, body: { item: 'R-1', kind: 'report', title: 'x', [k]: 1 } }), /may not carry/);
    }
    assert.throws(() => s.log.append({ id: 'R-1', event: 'add', actor: { kind: 'ai' }, body: { item: 'Q-1', kind: 'report', title: 'x' } }), /does not match/);
    assert.throws(() => s.log.append({ id: 'R-1', event: 'add', actor: { kind: 'robot' }, body: {} }), /bad actor/);
    assert(!fs.existsSync(file(s)) || lines(s).length === 0);
  });
  await t('crafted lines: another project id, a writer field that is not the file owner, unknown body keys → dropped / unverified', () => {
    const s = setup();
    add(s.log, 1);
    appendRaw(s, { project: 'pzzzzzzzzzzzzzzzz' });
    let r = s.log.read(s.trust());
    assert.strictEqual(r.stats.broken, 1);
    const s2 = setup();
    add(s2.log, 1, { mcpServers: { evil: { command: 'calc' } }, hooks: 1 });
    r = s2.log.read(s2.trust());
    assert.strictEqual(r.lines[0].body.mcpServers, undefined);
    assert.strictEqual(r.lines[0].body.hooks, undefined);
    // 남의 이름으로 된 줄을 내 파일에(sig.w 를 바꿈)
    const other = W.loadOrCreateWriter(path.join(tmp(), 'k'));
    const ls = lines(s2);
    const v = JSON.parse(ls[0]); delete v.sig;
    put(s2, [C.canonicalJson({ ...v, sig: { w: other.writerId, s: other.sign(W.signingBytes(v)) } })]);
    assert.strictEqual(s2.log.read(s2.trust()).lines[0].status, 'unverified');
  });
  await t("another writer's file: unknown key → unverified; with its card → untrusted (not countable); after person trust → ok", () => {
    const s = setup();
    const kd2 = path.join(tmp(), 'keys2');
    const other = W.loadOrCreateWriter(kd2);
    const log2 = s.mk(WK.WORK_SPEC, { keyDir: kd2 });
    log2.open(other);
    add(log2, 7);
    let r = s.log.read(s.trust());
    assert.strictEqual(r.lines[0].status, 'unverified');
    const card = W.makeWriterCard(other, '이OO', 'PC-2', 'now');
    r = s.log.read(s.trust(), new Map([[other.writerId, card]]));
    assert.strictEqual(r.lines[0].status, 'untrusted');
    assert(!L.countable(r.lines[0]));
    W.setTrust(s.keyDir, card, true, 'now');
    r = s.log.read(s.trust());
    assert.strictEqual(r.lines[0].status, 'ok');
  });
  await t('segment rotation keeps one chain across files', () => {
    const s = setup({ segmentBytes: 2048 });
    for (let i = 1; i <= 12; i += 1) { add(s.log, i); }
    const files = fs.readdirSync(path.dirname(file(s))).filter((n) => n.endsWith('.jsonl'));
    assert(files.length >= 3, files.join(','));
    const r = s.log.read(s.trust());
    assert.strictEqual(r.lines.length, 12);
    assert(r.lines.every((l) => l.status === 'ok'));
    assert.deepStrictEqual(r.stats.chainBreaks, []);
  });
  await t('the log folder as a junction to elsewhere: nothing written there, nothing read from it', () => {
    const s = setup();
    const outside = tmp();
    fs.mkdirSync(path.join(s.root, '.stcfsd', 'log'), { recursive: true });
    if (!tryLink(outside, path.join(s.root, '.stcfsd', 'log', 'assumptions'), 'junction')) { return 'skip'; }
    const a = s.mk(rec('assumptions').ASSUMPTION_SPEC);
    assert.throws(() => a.open(s.w), /link or junction/);
    fs.writeFileSync(path.join(outside, `${s.w.writerId}.jsonl`), '{}\n');
    assert.strictEqual(a.read(s.trust()).lines.length, 0);
    assert.deepStrictEqual(fs.readdirSync(outside), [`${s.w.writerId}.jsonl`]);
  });
  await t('ownership: an owner signed by this PC for a live other process keeps its stream; unsigned / dead / other-host owners are taken over (V7-29)', () => {
    const s = setup();
    s.log.close();
    const dir = path.dirname(file(s));
    const signedOwner = (stream, pid, host) => {
      const body = { pid, host, startedAt: 'x', stream };
      return JSON.stringify({ ...body, sig: s.w.sign('stcfsd-owner/1\n' + C.canonicalJson(body)) });
    };
    // 서명 없는 표지(이 PC 이름 · 산 pid 를 흉내 내도) — 넘겨받는다
    fs.writeFileSync(path.join(dir, `${s.w.writerId}.owner`), JSON.stringify({ pid: process.ppid, host: 'test-host', startedAt: 'x' }));
    assert.strictEqual(s.log.open(s.w), s.w.writerId);
    s.log.close();
    // 서명했지만 죽은 pid — 넘겨받는다
    fs.writeFileSync(path.join(dir, `${s.w.writerId}.owner`), signedOwner(s.w.writerId, 2147483000, 'test-host'));
    assert.strictEqual(s.log.open(s.w), s.w.writerId);
    s.log.close();
    // 서명했고 이 PC 의 산 다른 프로세스(부모) — 다음 이름
    fs.writeFileSync(path.join(dir, `${s.w.writerId}.owner`), signedOwner(s.w.writerId, process.ppid, 'test-host'));
    assert.strictEqual(s.log.open(s.w), `${s.w.writerId}-2`);
    s.log.close();
    assert(!fs.existsSync(path.join(dir, `${s.w.writerId}-2.owner`)));
    assert(fs.existsSync(path.join(dir, `${s.w.writerId}.owner`)), 'the live owner is left alone');
    // 다른 키로 서명한 표지 — 넘겨받는다
    fs.unlinkSync(path.join(dir, `${s.w.writerId}.owner`));
    const other = W.loadOrCreateWriter(path.join(tmp(), 'k'));
    const body = { pid: process.ppid, host: 'test-host', startedAt: 'x', stream: s.w.writerId };
    fs.writeFileSync(path.join(dir, `${s.w.writerId}.owner`), JSON.stringify({ ...body, sig: other.sign('stcfsd-owner/1\n' + C.canonicalJson(body)) }));
    assert.strictEqual(s.log.open(s.w), s.w.writerId);
    s.log.close();
  });
  await t('read budget: past the project limit, files are skipped and reported', () => {
    const s = setup();
    for (let i = 1; i <= 5; i += 1) { add(s.log, i); }
    const r = s.log.read(s.trust(), new Map(), new L.ReadBudget(100));
    assert.strictEqual(r.lines.length, 0);
    assert.strictEqual(r.stats.skippedFiles.length, 1);
  });
  await t('two processes writing as the same writer get separate files; both chains intact; 100 lines verified', async () => {
    const s = setup();
    s.log.close();
    const parent = s.mk();
    const child = fork(path.join(__dirname, '_child_writer.js'), [s.root, PID, s.keyDir, '50'], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    let mine;
    let childStream;
    try {
      childStream = await new Promise((ok, no) => { child.once('message', (m) => ok(m.stream)); child.once('exit', (c) => no(new Error(`child exited ${c}: ${err}`))); });
      mine = parent.open(s.w);
      assert.notStrictEqual(mine, childStream);
      const finished = new Promise((ok, no) => { child.on('message', (m) => { if (m.done) { ok(); } }); child.once('exit', (c) => { if (c) { no(new Error(err)); } }); });
      finished.catch(() => {});
      child.send('go');
      for (let i = 1; i <= 50; i += 1) { add(parent, i); if (i % 5 === 0) { await new Promise((r) => setImmediate(r)); } }
      await finished;
      await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
    } finally {
      if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); }
      parent.close();
    }
    const r = parent.read(s.trust());
    assert.strictEqual(r.lines.length, 100);
    assert(r.lines.every((l) => l.status === 'ok'));
    assert.deepStrictEqual(r.stats.chainBreaks, []);
    assert.deepStrictEqual([...new Set(r.lines.map((l) => l.stream))].sort(), [mine, childStream].sort());
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file(s))).filter((n) => n.endsWith('.owner')), []);
  });
  await t('project root folders stay fixed: the log lives under .stcfsd/log/<type>/ of the given root only', () => {
    const s = setup();
    add(s.log, 1);
    assert(fs.existsSync(path.join(s.root, P.DATA_DIR, 'log', 'work')));
    assert.deepStrictEqual(fs.readdirSync(s.root), ['.stcfsd']);
  });

  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
