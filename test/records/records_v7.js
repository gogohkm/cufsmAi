/* global require, module, process, __dirname, Buffer */
// V7(독립 검증) 이 찾은 기록 모듈의 결함 V7-20 – 34 · 살아남은 돌연변이 M5 · M6 · M7 · M8 · M10 — 고친 동작마다 시험 하나 이상.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { rec, tmp, tryLink, suite } = require('./_harness');

async function run() {
  const { t, done } = suite('records_v7');
  const C = rec('canonical'), W = rec('writer'), L = rec('log'), WK = rec('work'), A = rec('assumptions'), S = rec('sources'), P = rec('project');
  const N = rec('names'), X = rec('fsx'), POL = rec('policy'), CH = rec('changes'), T = rec('changeText');
  const PID = 'pabcdefghijklmnop';

  function setup(spec = WK.WORK_SPEC, limits) {
    const root = tmp();
    const keyDir = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(keyDir);
    W.trustSelf(keyDir, w, 'me', 'now');
    const mk = (sp = spec, extra = {}) => new L.RecordLog({ rootReal: root, projectId: PID, spec: sp, host: 'test-host', keyDir, limits, ...extra });
    const log = mk();
    log.open(w);
    return { root, keyDir, w, mk, log, trust: () => W.readTrust(keyDir).store };
  }
  const report = (n) => ({ id: `R-${n}`, event: 'add', actor: { kind: 'ai' }, body: { item: `R-${n}`, kind: 'report', caseId: null, title: `보고 ${n}`, body: '', refs: [], items: [] } });
  const dirOf = (s, type = 'work') => path.join(s.root, '.stcfsd', 'log', type);
  const fileOf = (s, name, type = 'work') => path.join(dirOf(s, type), name || `${s.w.writerId}.jsonl`);
  const linesOf = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((x) => x.trim());
  const unsigned = (fields) => C.canonicalJson({ schema: 'stcfsd-rec/work/1', at: '2099-01-01T00:00:00Z', project: PID, actor: { kind: 'ai' }, prev: null, ...fields });
  /** 서명 · 사슬을 맞춘 줄을 손으로 덧붙인다(그 줄 파일의 마지막 줄 뒤에) */
  function appendSigned(file, writer, fields) {
    const ls = fs.existsSync(file) ? linesOf(file) : [];
    const last = ls.length ? JSON.parse(ls[ls.length - 1]) : null;
    // 시각은 늘 「지금」 뒤 — 읽기는 시각 차례로 내고, 손으로 덧붙인 줄이 진짜 줄 뒤에 온다고 보는 시험(M7)이 있다(박아 둔 날짜가 지나자 차례가 뒤집혔다)
    const v = { at: '2099-01-01T00:00:00Z', project: PID, actor: { kind: 'ai' }, seq: last ? last.seq + 1 : 1, prev: last ? 'sha256:' + C.sha256Hex(ls[ls.length - 1]) : null, ...fields };
    fs.appendFileSync(file, C.canonicalJson({ ...v, sig: { w: writer.writerId, s: writer.sign(W.signingBytes(v)) } }) + '\n');
  }

  // ── V7-20 · 21 · 22 · 34 — 사슬 ───────────────────────────────────
  await t('V7-20: an unsigned line with a huge seq costs only itself — the next line follows the last verified one and counts', () => {
    const s = setup();
    s.log.append(report(1)); s.log.append(report(2));
    fs.appendFileSync(fileOf(s), unsigned({ seq: 1000, id: 'R-999', event: 'add', stream: s.w.writerId, item: 'R-999', kind: 'report', title: 'x', sig: { w: s.w.writerId, s: 'AAAA' } }) + '\n');
    const l3 = s.log.append(report(3));
    assert.strictEqual(l3.seq, 3);
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.filter(L.countable).map((l) => l.seq), [1, 2, 3]);
    assert.strictEqual(r.lines.find((l) => l.seq === 1000).status, 'unverified');
    assert.deepStrictEqual(r.stats.chainBreaks, []);
    assert.strictEqual(r.lines.filter((l) => l.id === 'R-3' && L.countable(l)).length, 1);
  });
  await t('V7-21: a CRLF conversion and a BOM change neither the hashes nor the signatures; writing continues after it', () => {
    const s = setup();
    for (let i = 1; i <= 3; i += 1) { s.log.append(report(i)); }
    fs.writeFileSync(fileOf(s), '﻿' + fs.readFileSync(fileOf(s), 'utf8').replace(/\n/g, '\r\n'));
    let r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => l.status), ['ok', 'ok', 'ok']);
    assert.deepStrictEqual([r.stats.chainBreaks, r.stats.shrunk, r.stats.broken], [[], [], 0]);
    s.log.append(report(4));
    r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [[1, 'ok'], [2, 'ok'], [3, 'ok'], [4, 'ok']]);
  });
  await t('V7-34: a line whose text is not the canonical form of its value is refused (1.0e0, duplicate key, escape, key order, 2^53+1, __proto__)', () => {
    const s = setup();
    s.log.append(report(1));
    const raw = linesOf(fileOf(s))[0];
    const variants = [
      raw.replace('"seq":1,', '"seq":1.0e0,'),
      raw.replace('"title":"보고 1"', '"title":"보고 1","title":"보고 1"'),
      raw.replace('"title":"보고 1"', '"title":"\\ubcf4\\uace0 1"'),
      raw.replace('{"actor"', '{ "actor"'),
      '{"z":1,' + raw.slice(1).replace(/,"z":1/, ''),
      raw.replace('"seq":1,', '"seq":9007199254740993,'),
      raw.replace('"body":""', '"__proto__":{"title":"P"},"body":""'),
    ];
    for (const v of variants) {
      assert.notStrictEqual(v, raw);
      fs.writeFileSync(fileOf(s), v + '\n');
      const r = s.log.read(s.trust(), new Map(), undefined, { recordSeen: false });
      assert.strictEqual(r.lines.length, 0, v.slice(0, 60));
      assert.strictEqual(r.stats.nonCanonical, 1, v.slice(0, 60));
    }
    assert.strictEqual(C.parseCanonicalLine(raw).ok, true);
  });
  await t('V7-22: segment numbers are 2–999; an out-of-range planted segment is ignored; a planted next segment is skipped when rolling over', () => {
    const s = setup(WK.WORK_SPEC, { segmentBytes: 1200 });
    s.log.append(report(1));
    fs.writeFileSync(fileOf(s, `${s.w.writerId}.10000.jsonl`), 'x\n');
    fs.writeFileSync(fileOf(s, `${s.w.writerId}.2.jsonl`), ' '.repeat(2000) + '\n');
    for (let i = 2; i <= 6; i += 1) { s.log.append(report(i)); }
    const names = fs.readdirSync(dirOf(s)).filter((n) => n.endsWith('.jsonl')).sort();
    assert(names.includes(`${s.w.writerId}.3.jsonl`), names.join(','));
    assert.strictEqual(fs.readFileSync(fileOf(s, `${s.w.writerId}.2.jsonl`), 'utf8'), ' '.repeat(2000) + '\n', 'the planted segment is not written into');
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.seq, l.status]), [1, 2, 3, 4, 5, 6].map((n) => [n, 'ok']));
    assert(r.stats.skippedFiles.includes(`${s.w.writerId}.10000.jsonl`));
  });

  // ── V7-26 — 자리 · 동료의 되감기 ────────────────────────────────────
  await t('V7-26b: a copy of my stream under another stream name does not count twice (stream is inside the signature)', () => {
    const s = setup();
    s.log.append(report(1)); s.log.append(report(2));
    fs.copyFileSync(fileOf(s), fileOf(s, `${s.w.writerId}-5.jsonl`));
    const r = s.log.read(s.trust());
    assert.strictEqual(r.lines.filter(L.countable).length, 2);
    assert.strictEqual(r.stats.misplaced, 2);
  });
  await t('V7-26: a line moved into another project or another record type folder is refused (M8)', () => {
    const s = setup();
    s.log.append(report(1));
    const other = new L.RecordLog({ rootReal: s.root, projectId: 'pzzzzzzzzzzzzzzzz', spec: WK.WORK_SPEC, host: 'h', keyDir: s.keyDir });
    assert.strictEqual(other.read(s.trust()).lines.length, 0);
    fs.mkdirSync(dirOf(s, 'assumptions'), { recursive: true });
    fs.copyFileSync(fileOf(s), fileOf(s, undefined, 'assumptions'));
    const a = s.mk(A.ASSUMPTION_SPEC).read(s.trust());
    assert.deepStrictEqual([a.lines.length, a.stats.broken], [0, 1]);
  });
  await t('V7-26a: truncating a trusted colleague\'s line file is noticed (high-water mark for every trusted writer)', () => {
    const s = setup();
    const kb = path.join(tmp(), 'kb');
    const wb = W.loadOrCreateWriter(kb);
    W.setTrust(s.keyDir, W.makeWriterCard(wb, 'colleague', 'pc-b', 'now'), true, 'now');
    const lb = new L.RecordLog({ rootReal: s.root, projectId: PID, spec: WK.WORK_SPEC, host: 'pc-b', keyDir: kb });
    lb.open(wb);
    for (let i = 1; i <= 3; i += 1) { lb.append(report(i)); }
    assert.deepStrictEqual(s.log.read(s.trust()).stats.shrunk, []);
    const fb = fileOf(s, `${wb.writerId}.jsonl`);
    fs.writeFileSync(fb, linesOf(fb).slice(0, 1).join('\n') + '\n');
    assert.deepStrictEqual(s.log.read(s.trust()).stats.shrunk, [{ stream: wb.writerId, expectedSeq: 3, foundSeq: 1 }]);
  });
  await t('M7: a line signed by a trusted colleague but placed in my file (claiming my stream) does not count', () => {
    const s = setup();
    const kb = path.join(tmp(), 'kb');
    const wb = W.loadOrCreateWriter(kb);
    W.setTrust(s.keyDir, W.makeWriterCard(wb, 'colleague', 'pc-b', 'now'), true, 'now');
    s.log.append(report(1));
    appendSigned(fileOf(s), wb, { schema: 'stcfsd-rec/work/1', id: 'R-2', event: 'add', stream: s.w.writerId, item: 'R-2', kind: 'report', title: 'from b' });
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.id, L.countable(l)]), [['R-1', true], ['R-2', false]]);
  });
  await t('M5: assertNoLinks still refuses when a caller passes a root that is itself a junction (final realpath check)', () => {
    const base = tmp(), real = tmp();
    const j = tryLink(real, path.join(base, 'j'), 'junction');
    if (!j) { return 'skip'; }
    assert.throws(() => X.assertNoLinks(j, path.join(j, 'x.txt')), /leaves the project folder/);
  });

  // ── V7-29 · 30 · 33 — 이름공간을 쓰는 심은 것 ─────────────────────────
  await t('V7-29: nine planted unsigned .owner files do not stop this PC from writing', () => {
    const s = setup();
    s.log.close();
    for (let k = 1; k <= 9; k += 1) {
      const n = k === 1 ? s.w.writerId : `${s.w.writerId}-${k}`;
      fs.writeFileSync(path.join(dirOf(s), `${n}.owner`), JSON.stringify({ pid: process.ppid, host: 'test-host', startedAt: 'x', stream: n, sig: 'AAAA' }));
    }
    assert.strictEqual(s.mk().open(s.w), s.w.writerId);
  });
  await t('V7-30: unverified add Q-99999 / A-9999 / S-9999 do not consume the id space', () => {
    const fake = 'w' + 'a'.repeat(20);
    const mkLine = (type, item, extra) => C.canonicalJson({ schema: `stcfsd-rec/${type}/1`, seq: 1, id: item, event: extra.event, at: 'z', project: PID, stream: fake,
      actor: { kind: 'ai' }, prev: null, item, ...extra.body, sig: { w: fake, s: 'AAAA' } });
    const s = setup();
    fs.writeFileSync(fileOf(s, `${fake}.jsonl`), mkLine('work', 'Q-99999', { event: 'add', body: { kind: 'question', title: 'x' } }) + '\n');
    const lines = s.log.read(s.trust()).lines;
    assert.strictEqual(WK.prepareWork('add', { kind: 'question', title: 'q' }, lines).id, 'Q-1');
    const sa = setup(A.ASSUMPTION_SPEC);
    fs.writeFileSync(fileOf(sa, `${fake}.jsonl`, 'assumptions'), mkLine('assumptions', 'A-9999', { event: 'add', body: { origin: 'ai', text: 'x', status: 'firm' } }) + '\n');
    assert.strictEqual(A.prepareAssumption('add', { text: 'a', status: 'firm' }, sa.log.read(sa.trust()).lines).id, 'A-01');
    const ss = setup(S.SOURCE_SPEC);
    fs.writeFileSync(fileOf(ss, `${fake}.jsonl`, 'sources'), mkLine('sources', 'S-9999', { event: 'register', body: { path: '01_원자료/a.pdf', sha256: 'a'.repeat(64) } }) + '\n');
    assert.strictEqual(S.nextSourceId(ss.log.read(ss.trust()).lines), 'S-1');
  });
  await t('V7-33: inherited names are not accepted as kinds; a body key __proto__ never becomes a prototype', () => {
    for (const kind of ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'valueOf']) {
      assert.throws(() => WK.prepareWork('add', { kind, title: 'x' }, []), /kind must be/, kind);
    }
    assert.strictEqual(WK.readWorkBody('add', JSON.parse('{"item":"R-2","kind":"toString","title":"t"}')), null);
    const s = setup();
    assert.throws(() => s.log.append({ ...report(1), body: { ...report(1).body, constructor: 1 } }), /would not read back|may not carry|does not match/);
  });

  // ── V7-23 — 검증 안 된 줄은 상태를 바꾸지 않는다 · 누가 무엇을 ───────────────
  await t('V7-23: an unsigned assumption update (not-applicable) does not clear the issue blocker; it is listed as an unverified entry', () => {
    const s = setup(A.ASSUMPTION_SPEC);
    const p = A.prepareAssumption('add', { text: '데크가 횡지지', status: 'provisional' }, []);
    s.log.append({ ...p, actor: { kind: 'ai' } });
    const fake = 'w' + 'b'.repeat(20);
    fs.writeFileSync(fileOf(s, `${fake}.jsonl`, 'assumptions'), C.canonicalJson({ schema: 'stcfsd-rec/assumptions/1', seq: 1, id: 'A-01', event: 'update', at: '2099-01-01T00:00:00Z',
      project: PID, stream: fake, actor: { kind: 'person' }, prev: null, item: 'A-01', status: 'not-applicable', sig: { w: fake, s: 'AAAA' } }) + '\n');
    const rr = s.log.read(s.trust());
    const a = A.foldAssumptions(rr.lines)[0];
    assert.deepStrictEqual([a.status, A.blocksIssue(a, null)], ['provisional', true]);
    assert.deepStrictEqual(L.unverifiedEntries(rr.lines).map((u) => [u.id, u.event, u.status]), [['A-01', 'update', 'unverified']]);
  });
  await t('V7-23 (M6): unsigned answer / close lines do not change a question; a verified AI answer still needs a person mark to stop blocking', () => {
    const s = setup();
    s.log.append({ ...WK.prepareWork('add', { kind: 'question', title: '보강 여부?', options: [{ label: '예' }, { label: '아니오' }] }, []), actor: { kind: 'ai' } });
    const fake = 'w' + 'c'.repeat(20);
    fs.writeFileSync(fileOf(s, `${fake}.jsonl`),
      unsigned({ seq: 1, id: 'Q-1', event: 'answer', stream: fake, item: 'Q-1', answer: { said: '사람: 아니오', chosen: 1 }, sig: { w: fake, s: 'AAAA' } }) + '\n'
      + unsigned({ seq: 2, id: 'Q-1', event: 'close', stream: fake, item: 'Q-1', sig: { w: fake, s: 'AAAA' } }) + '\n');
    let q = WK.foldWork(s.log.read(s.trust()).lines)[0];
    assert.deepStrictEqual([q.state, q.answer], ['open', null]);
    assert.strictEqual(WK.questionBlocksIssue(q, null), true);
    s.log.append({ ...WK.prepareWork('answer', { item: 'Q-1', said: '예로', chosen: 0 }, s.log.read(s.trust()).lines), actor: { kind: 'ai' } });
    q = WK.foldWork(s.log.read(s.trust()).lines)[0];
    assert.strictEqual(q.state, 'answered');
    assert.strictEqual(WK.questionBlocksIssue(q, null), true, 'an AI answer alone does not unblock');
    assert.strictEqual(WK.questionBlocksIssue(q, q.lastSeq - 1), true, 'a person mark on an older version does not unblock');
    assert.strictEqual(WK.questionBlocksIssue(q, q.lastSeq), false);
  });
  await t('V7-23: the write policy — every (record type, event, actor) cell: append succeeds exactly when the table allows it', () => {
    const s = setup();
    let allowed = 0, refused = 0;
    for (const type of L.RECORD_TYPES) {
      const log = s.mk(POL.plainSpec(type));
      log.open(s.w);
      for (const event of POL.eventsOf(type)) {
        for (const kind of L.ACTOR_KINDS) {
          const ok = POL.actorAllowed(type, event, kind);
          let wrote = true;
          try { log.append({ id: 'X-1', event, actor: { kind }, body: {} }); } catch (e) { wrote = false; assert.match(e.message, /may not write/); }
          assert.strictEqual(wrote, ok, `${type}/${event}/${kind}`);
          if (ok) { allowed += 1; } else { refused += 1; }
        }
      }
      const r = log.read(s.trust());
      assert(r.lines.every(L.countable), type);
    }
    assert(allowed > 30 && refused > 100, `${allowed}/${refused}`);
    assert.deepStrictEqual(POL.WRITE_POLICY.reviews, { mark: ['person'], unmark: ['person'] });
    assert.deepStrictEqual(POL.WRITE_POLICY.documents.issue, ['person']);
  });
  await t('V7-23: a signed line whose actor the table does not allow is read as refused and never counts', () => {
    const s = setup(POL.plainSpec('reviews'));
    const f = fileOf(s, undefined, 'reviews');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    appendSigned(f, s.w, { schema: 'stcfsd-rec/reviews/1', id: 'V-1', event: 'mark', stream: s.w.writerId, actor: { kind: 'ai' } });
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.map((l) => [l.status, L.countable(l)]), [['refused', false]]);
    assert.strictEqual(r.stats.refused, 1);
  });

  // ── V7-24 — 제목은 거짓을 말하지 않는다 ──────────────────────────────
  const ctx = { caseId: 'cabcdefghijklmnop', actor: { kind: 'ai' }, trigger: 'set_case_inputs' };
  const base = () => ({ model: { sectionTemplate: 'lippedc', sectionParams: { H: 8, B: 2.5, D: 0.75, t: 0.0566, r: 0.1875 },
    node: [[1, 0, 0, 1, 1, 1, 1, 50], [2, 2.5, 0, 1, 1, 1, 1, 50], [3, 2.5, 8, 1, 1, 1, 1, 50]], elem: [[1, 1, 2, 0.0566, 100], [2, 2, 3, 0.0566, 100]],
    prop: [[100, 29500, 29500, 0.3, 0.3, 11346]] }, case: { inputs: { fy: 50, Lb: 72 }, spans: null, mcpOnly: {} } });
  const info = (k) => (k === 'fy' ? { group: 'material', unit: 'stress' } : k === 'Lb' ? { group: 'member', unit: 'length' } : null);
  const title = (b, a, units = 'US') => CH.buildChange(ctx, b, a, { fieldInfo: info, units }).title;
  const values = (tt) => { const m = /^(.*?) (\S+) → (.+?)( [a-zA-Z^/-]+)?( 외 \d+)?$/.exec(tt); return m ? [m[2], m[3]] : null; };
  await t('V7-24 ①: a real change never reads as equal — "fy 50 → 50.0000004 ksi", also in SI and for 0 / -0', () => {
    const b = base(), a = base(); a.case.inputs.fy = 50.0000004;
    const tt = title(b, a);
    assert.strictEqual(tt, 'fy 50 → 50.0000004 ksi');
    const si = title(b, a, 'SI');
    const v = values(si);
    assert(v && v[0] !== v[1], si);
    const [x, y] = T.formatPair(0, -0, null, 'US');
    assert.notStrictEqual(x, y);
  });
  await t('V7-24 ②: hand-made geometry changes are not hidden behind a template tweak ("외 n" counts them)', () => {
    const b = base(), a = base();
    a.model.sectionParams.r = 0.18750001; a.model.elem = a.model.elem.map((e) => [e[0], e[1], e[2], 0.04, e[4]]); a.model.node[2][2] = 10;
    const tt = title(b, a);
    assert.match(tt, /외 2$/);
    const regen = base(), regen2 = base();
    regen2.model.sectionParams.t = 0.07; regen2.model.elem = regen2.model.elem.map((e) => [e[0], e[1], e[2], 0.07, e[4]]); regen2.model.node[2][2] = 8.01;
    assert.strictEqual(title(regen, regen2), '두께 t 0.0566 → 0.07 in');
  });
  await t('V7-24 ③: the headline is the largest relative change (fy 50 → 80 is not hidden behind a tiny r change)', () => {
    const b = base(), a = base(); a.model.sectionParams.r = 0.18750001; a.case.inputs.fy = 80;
    assert.strictEqual(title(b, a), 'fy 50 → 80 ksi 외 1');
  });
  await t('V7-24 ④ ⑤ ⑥: text values are quoted and cleaned; odd key names are not shown; "72" and 72 differ', () => {
    const b = base(), a = base(); a.case.mcpOnly = { aisi_design_flexure: { note: 'x‮ksi 08 → 05 yf\n외 0' } };
    const t4 = title(b, a);
    assert(!/[‮\n]/.test(t4) && (t4.match(/→/g) || []).length === 1 && t4.includes('「'), t4);
    const b5 = base(), a5 = base(); a5.model.sectionParams['t 0.0566 → 0.0566 in (변경 없음)'] = 1;
    const t5 = title(b5, a5);
    assert(!t5.includes('변경 없음') && t5.includes('이름 꼴 밖'), t5);
    const b6 = base(), a6 = base(); a6.case.inputs.Lb = '72';
    const v = values(title(b6, a6));
    assert(v && v[0] !== v[1], title(b6, a6));
  });
  await t('V7-24: one rule — no tolerance: the smallest difference is a change in the differ, the fingerprint and the title alike', () => {
    const b = base(), a = base(); a.case.inputs.Lb = 72 + 1e-12;
    const ch = CH.buildChange(ctx, b, a, { fieldInfo: info, units: 'US' });
    assert(ch && ch.before.caseFp !== ch.after.caseFp);
    const v = values(ch.title);
    assert(v && v[0] !== v[1], ch.title);
  });

  // ── V7-25 · 28 · 31 · 32 ──────────────────────────────────────────
  await t('V7-25: the issued copy at 04_발행본/<case>/R0/x.csd is found with the default depth', () => {
    const root = tmp();
    const { dir } = P.createProject(root, 'p', { now: '', version: '' });
    assert.deepStrictEqual(P.findProjectFor(path.join(dir, '04_발행본', '퍼린 P1', 'R0', '퍼린 P1.csd')), { dir, issued: true });
  });
  await t('V7-28: twelve processes creating the key at once all get the same complete key; no temp file is left', async () => {
    const kd = path.join(tmp(), 'keys');
    fs.mkdirSync(kd);
    const kids = Array.from({ length: 12 }, () => fork(path.join(__dirname, '_child_key.js'), [kd], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }));
    try {
      await Promise.all(kids.map((k) => new Promise((ok) => k.once('message', ok))));
      const res = Promise.all(kids.map((k) => new Promise((ok) => k.once('message', ok))));
      kids.forEach((k) => k.send('go'));
      const out = await res;
      assert.deepStrictEqual(out.filter((o) => o.error), []);
      assert.strictEqual(new Set(out.map((o) => o.id)).size, 1);
      await Promise.all(kids.map((k) => (k.exitCode !== null ? null : new Promise((ok) => k.once('exit', ok)))));
      assert.deepStrictEqual(fs.readdirSync(kd), ['writer.key']);
    } finally { for (const k of kids) { if (k.exitCode === null) { k.kill(); } } }
  });
  await t('V7-28: an empty or partial key file is KeyUnavailableError with a recovery message, never replaced', () => {
    const kd = path.join(tmp(), 'keys');
    W.loadOrCreateWriter(kd);
    const f = path.join(kd, 'writer.key');
    const pem = fs.readFileSync(f, 'utf8');
    for (const bad of ['', pem.slice(0, 40)]) {
      fs.writeFileSync(f, bad);
      assert.throws(() => W.loadOrCreateWriter(kd), (e) => e instanceof W.KeyUnavailableError && /empty or incomplete/.test(e.message) && /delete it/.test(e.message));
      assert.strictEqual(fs.readFileSync(f, 'utf8'), bad);
    }
  });
  await t('V7-31: look-alike and invisible names are refused naming the character; ordinary Korean names pass', () => {
    const bad = ['물류​창고', 'ㅤ', 'a‍', 'P1⁠', '퍼린　', 'P1 ', 'CLOCK$', 'clock$.txt', 'CON​', 'a~1', 'a　b', 'a  b',
      '́a', 'xᅟy', 'aﾠ', 'a﻿b', '%TEMP%', 'a=b', 'a!b'];
    for (const n of bad) {
      const r = N.checkName(n);
      assert.strictEqual(r.ok, false, JSON.stringify(n));
    }
    assert.match(N.checkName('물류​창고').error, /U\+200B/);
    for (const n of ['물류창고 지붕', '퍼린 P1 (처마)', 'Z-200×75×20×2.3', 'A·B', "O'Neil", '거트_G2', 'Café']) {
      assert.strictEqual(N.checkName(n).ok, true, n);
    }
    assert.strictEqual(N.segmentError('CLOCK$.json') !== null, true);
    assert.strictEqual(N.segmentError('My Folder (2024)!'), null, 'existing folder names keep the old (negative) rules for the host');
    const root = tmp();
    for (const p of ['STCFSD~1/x.txt', '01_원자료/a​b.pdf', '01_원자료/ㅤ.pdf']) { assert.throws(() => X.resolveInside(root, p), X.RecordsPathError, p); }
  });
  await t('V7-32: a hard link inside 01_원자료 to a file outside is not registered; a hard-linked line file is not appended to', () => {
    const s = setup(S.SOURCE_SPEC);
    fs.mkdirSync(path.join(s.root, '01_원자료'));
    const outside = path.join(tmp(), 'secret.txt');
    fs.writeFileSync(outside, 'password=hunter2');
    try { fs.linkSync(outside, path.join(s.root, '01_원자료', 'drawing.pdf')); } catch { return 'skip'; }
    assert.throws(() => S.prepareSource(s.root, 'register', { path: '01_원자료/drawing.pdf' }, []), /hard links/);
    const w = setup();
    w.log.append(report(1));
    const out2 = path.join(tmp(), 'victim.txt');
    fs.writeFileSync(out2, 'keep');
    fs.unlinkSync(fileOf(w));
    fs.linkSync(out2, fileOf(w));
    assert.throws(() => w.log.append(report(2)), /hard links/);
    assert.strictEqual(fs.readFileSync(out2, 'utf8'), 'keep');
  });
  await t('M10: setTrust(…, false) never removes this PC\'s own (self) writer', () => {
    const kd = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(kd);
    W.trustSelf(kd, w, 'me', 'now');
    const store = W.setTrust(kd, W.makeWriterCard(w, 'me', 'pc', 'now'), false, 'now');
    assert(store.writers[w.writerId] && store.writers[w.writerId].by === 'self');
  });
  await t('fold results never include an unverified, untrusted, misplaced or refused line (sources too)', () => {
    const s = setup(S.SOURCE_SPEC);
    fs.mkdirSync(path.join(s.root, '01_원자료'));
    fs.writeFileSync(path.join(s.root, '01_원자료', 'a.pdf'), 'a');
    s.log.append({ ...S.prepareSource(s.root, 'register', { path: '01_원자료/a.pdf' }, []), actor: { kind: 'ai' } });
    const fake = 'w' + 'd'.repeat(20);
    fs.writeFileSync(fileOf(s, `${fake}.jsonl`, 'sources'), C.canonicalJson({ schema: 'stcfsd-rec/sources/1', seq: 1, id: 'S-1', event: 'update', at: '2099', project: PID, stream: fake,
      actor: { kind: 'ai' }, prev: null, item: 'S-1', sha256: 'f'.repeat(64), title: 'forged', sig: { w: fake, s: 'AAAA' } }) + '\n');
    const f = S.foldSources(s.log.read(s.trust()).lines);
    assert.deepStrictEqual([f[0].title, f[0].sha256 === 'f'.repeat(64)], ['a.pdf', false]);
    void Buffer;
  });

  // ── 첫 돌연변이 실행에서 살아남은 것(V-M4 · V-M8 · N3) ───────────────────
  await t('segmentError itself (used by the host for existing paths) refuses text-direction characters', () => {
    for (const seg of ['abc\u202Egpj.exe', 'x\u2066y', '\u200Ex', 'a\u061cb']) { assert.notStrictEqual(N.segmentError(seg), null, JSON.stringify(seg)); }
  });
  await t('V-M8: a valid work line copied into another type folder with a matching event is refused even without a body check', () => {
    const s = setup();
    s.log.append(report(1));
    fs.mkdirSync(dirOf(s, 'assumptions'), { recursive: true });
    fs.copyFileSync(fileOf(s), fileOf(s, undefined, 'assumptions'));
    const r = s.mk(POL.plainSpec('assumptions')).read(s.trust());
    assert.deepStrictEqual([r.lines.length, r.stats.broken], [0, 1]);
  });
  await t('N3: a line replayed inside the same stream (duplicate or older seq) is not counted again', () => {
    const s = setup();
    s.log.append(report(1)); s.log.append(report(2));
    const ls = linesOf(fileOf(s));
    fs.appendFileSync(fileOf(s), ls[1] + '\n' + ls[0] + '\n');
    const r = s.log.read(s.trust());
    assert.deepStrictEqual(r.lines.filter(L.countable).map((l) => l.seq), [1, 2]);
    assert.strictEqual(r.stats.misplaced, 2);
    assert.deepStrictEqual(r.stats.chainBreaks, []);
  });
  await t('D7 / §2.6: an assumption closed by the AI still blocks; one closed by the program (its cause gone) does not', () => {
    const s = setup(A.ASSUMPTION_SPEC);
    s.log.append({ ...A.prepareAssumption('add', { text: 'ai one', status: 'provisional' }, []), actor: { kind: 'ai' } });
    s.log.append({ ...A.prepareAssumption('add', { text: '데크: t — 입력 기본값 그대로', status: 'provisional', originKey: 'default:deck' }, s.log.read(s.trust()).lines, 'program-default'), actor: { kind: 'program' } });
    s.log.append({ ...A.prepareAssumption('close', { item: 'A-01' }, s.log.read(s.trust()).lines), actor: { kind: 'ai' } });
    s.log.append({ ...A.prepareAssumption('close', { item: 'A-02', closedBy: 'ch-1' }, s.log.read(s.trust()).lines), actor: { kind: 'program' } });
    const f = A.foldAssumptions(s.log.read(s.trust()).lines);
    assert.deepStrictEqual(f.map((a) => [a.item, a.closed, a.closedByProgram, A.blocksIssue(a, null)]), [['A-01', true, false, true], ['A-02', true, true, false]]);
    assert.strictEqual(A.blocksIssue(f[0], f[0].lastSeq), false);
  });

  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
