/* global require, module, process, Buffer */
// R1-1 — 정규 JSON · 지문 · 이름 규칙 · 경로 규칙 · 프로젝트 선언 · 작성자 열쇠 · 믿음.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ROOT, rec, tmp, tryLink, suite } = require('./_harness');

async function run() {
  const { t, done } = suite('records_core');
  const C = rec('canonical'), F = rec('fp'), N = rec('names'), X = rec('fsx'), P = rec('project'), W = rec('writer');

  // ── 정규 JSON · 지문 ─────────────────────────────────────────────
  await t('canonical JSON sorts keys at every depth and ignores insertion order', () => {
    assert.strictEqual(C.canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } }), '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
    assert.strictEqual(C.fp('n', { a: 1, b: 2 }), C.fp('n', { b: 2, a: 1 }));
  });
  await t('canonical JSON refuses NaN, Infinity, undefined in arrays, functions, class instances', () => {
    for (const bad of [NaN, Infinity, -Infinity, [1, undefined], () => 1, new Date(0), { a: { b: NaN } }, 10n]) {
      assert.throws(() => C.canonicalJson(bad), C.CanonicalError, String(bad));
    }
    assert.strictEqual(C.canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  });
  await t('fingerprints are namespaced: the same value under two kinds differs', () => {
    assert.notStrictEqual(C.fp('stcfsd-fp/model/1', { x: 1 }), C.fp('stcfsd-fp/case/1', { x: 1 }));
    assert.match(C.fp('a', 1), C.FP_RE);
  });
  await t('MODEL_SIGNATURE_FIELDS = the fields of StcfsdPanel._modelSignature (read from the panel source)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8');
    const i = src.indexOf('private _modelSignature(');
    assert(i > 0, '_modelSignature not found');
    const block = src.slice(src.indexOf('JSON.stringify({', i), src.indexOf('});', i));
    const keys = [...block.matchAll(/^\s+([A-Za-z_]+):/gm)].map((m) => m[1]);
    assert.deepStrictEqual(keys, [...F.MODEL_SIGNATURE_FIELDS]);
  });
  await t('modelSignatureProjection uses the panel defaults (springs [], BC S-S, neigs 10, loadFy from node stress)', () => {
    const p = F.modelSignatureProjection({ node: [[1, 0, 0, 1, 1, 1, 1, -12.5], [2, 1, 0, 1, 1, 1, 1, 30]] });
    assert.deepStrictEqual([p.springs, p.constraints, p.BC, p.neigs, p.loadCase, p.loadFy, p.GBTcon], [[], [], 'S-S', 10, 'unknown', 30, {}]);
    assert.strictEqual(F.modelSignatureProjection({ loadFy: 50, node: [] }).loadFy, 50);
  });
  await t('modelFp changes with the section thickness, not with key order; caseFp ignores sources / rev / view', () => {
    const m = { node: [[1, 0, 0]], elem: [], sectionTemplate: 'lippedz', sectionParams: { t: 0.09, H: 8 } };
    assert.strictEqual(F.modelFp(m), F.modelFp({ sectionParams: { H: 8, t: 0.09 }, elem: [], node: [[1, 0, 0]], sectionTemplate: 'lippedz' }));
    assert.notStrictEqual(F.modelFp(m), F.modelFp({ ...m, sectionParams: { t: 0.1, H: 8 } }));
    const s = { inputs: { fy: 50 }, spans: null, mcpOnly: {} };
    assert.strictEqual(F.caseFp(s), F.caseFp({ ...s, sources: { fy: 'ai' }, rev: 9, view: { unitSystem: 'SI' } }));
    assert.notStrictEqual(F.caseFp(s), F.caseFp({ ...s, inputs: { fy: 55 } }));
  });
  await t('resultFp ignores the time stamp; docFp ignores created / stamp; checkKey ignores location key order', () => {
    assert.strictEqual(F.resultFp({ a: 1, _meta: { timestamp: 'x', k: 1 } }), F.resultFp({ a: 1, _meta: { timestamp: 'y', k: 1 } }));
    assert.notStrictEqual(F.resultFp({ a: 1 }), F.resultFp({ a: 2 }));
    assert.strictEqual(F.docFp({ meta: { title: 't', created: 'a', stamp: { kind: 'draft' } }, sections: [] }), F.docFp({ meta: { title: 't', created: 'b' }, sections: [] }));
    assert.strictEqual(F.checkKey({ scope: 'purlin', id: 'member.flexure.distortional', location: { region: 'n2', check_point: 'support 2' } }),
      F.checkKey({ scope: 'purlin', id: 'member.flexure.distortional', location: { check_point: 'support 2', region: 'n2' } }));
    assert.notStrictEqual(F.checkFp({ ratio: 0.87 }), F.checkFp({ ratio: 0.8700001 }));
  });
  await t('engine id is taken from the Python selftest, never computed here: normalize accepts hex / sha256:hex only', () => {
    const h = 'a'.repeat(64);
    assert.strictEqual(F.normalizeEngineId(h), `sha256:${h}`);
    assert.strictEqual(F.normalizeEngineId(`sha256:${h.toUpperCase()}`), `sha256:${h}`);
    for (const bad of [null, 2, '', 'abc', `sha1:${h}`, h + '0', `${h}\n`.repeat(2)]) { assert.strictEqual(F.normalizeEngineId(bad), null, String(bad)); }
  });

  // ── 이름 ────────────────────────────────────────────────────────
  await t('names: device names (with any extension, superscripts, CONIN$) are refused', () => {
    for (const n of ['CON', 'con', 'Con.txt', 'NUL', 'aux.csd', 'PRN.tar.gz', 'COM1', 'com9.x', 'LPT0', 'COM\u00b9', 'LPT\u00b3.csd', 'CONIN$', 'conout$.a', 'NUL .txt']) {
      assert.strictEqual(N.checkName(n).ok, false, n);
    }
    assert.strictEqual(N.checkName('CONSOLE').ok, true);
    assert.strictEqual(N.checkName('COM10').ok, true);
  });
  await t('names: separators, drive, ADS ":", forbidden chars, control and text-direction characters are refused', () => {
    for (const n of ['a/b', 'a\\b', 'C:', 'C:x', 'file.csd:stream', 'a<b', 'a>b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\u0000b', 'a\nb', 'a\u001fb', 'a\u007fb', 'abc\u202Egpj.exe', 'x\u2066y', '\u200Ex']) {
      assert.strictEqual(N.checkName(n).ok, false, JSON.stringify(n));
    }
  });
  await t('names: leading dot, trailing dot / space, ".", "..", leading space, empty, non-text are refused', () => {
    for (const n of ['.stcfsd', '.claude', 'a.', 'a ', 'a. ', '.', '..', ' a', '', null, 3, {}]) { assert.strictEqual(N.checkName(n).ok, false, JSON.stringify(n)); }
  });
  await t('names: very long names (61 characters, > 180 UTF-8 bytes) are refused; 60 Korean characters fit', () => {
    assert.strictEqual(N.checkName('a'.repeat(61)).ok, false);
    assert.strictEqual(N.checkName('가'.repeat(61)).ok, false);
    assert.strictEqual(N.checkName('가'.repeat(60)).ok, true);   // 180 바이트
    assert.strictEqual(N.checkName('😀'.repeat(46)).ok, false);  // 46 글자 · 184 바이트
  });
  await t('names: NFD input becomes NFC and compares equal; program folder names are refused (case-insensitive)', () => {
    const nfd = '퍼린 P1'.normalize('NFD');
    const r = N.checkName(nfd);
    assert(r.ok && r.name === '퍼린 P1'.normalize('NFC') && r.name !== nfd);
    assert.strictEqual(r.key, N.nameKey('퍼린 p1'));
    for (const n of ['02_검토대상', '04_발행본', 'STCFSD-PROJECT.JSON', '01_원자료'.normalize('NFD')]) { assert.strictEqual(N.checkName(n).ok, false, n); }
  });
  await t('text: over the limit is refused (never truncated); control and direction characters removed; CRLF → LF', () => {
    assert.strictEqual(N.cleanText('x'.repeat(301), 300).ok, false);
    const r = N.cleanText('a\r\nb\u0007c\u202Ed\te', 300);
    assert(r.ok && r.text === 'a\nbcd\te');
    assert.strictEqual(N.cleanText('   ', 10).ok, false);
    assert.strictEqual(N.cleanText(undefined, 10, { optional: true }).ok, true);
    assert.strictEqual(N.cleanText(5, 10).ok, false);
  });

  // ── 경로 · 파일 ──────────────────────────────────────────────────
  await t('resolveInside refuses absolute, drive, UNC, ADS, "..", ".", empty parts, dot names and leaving the folder', () => {
    const root = tmp();
    for (const p of ['C:/x', 'c:\\x', '/etc/passwd', '\\\\host\\share\\x', '//host/x', 'a/../b', '../x', './x', 'a//b', 'a/.hidden', 'a/b:s', 'a/b.', 'a/CON', '', '  ', null]) {
      assert.throws(() => X.resolveInside(root, p), X.RecordsPathError, JSON.stringify(p));
    }
    assert.strictEqual(X.resolveInside(root, '01_원자료\\도면.pdf').rel, '01_원자료/도면.pdf');
    assert.throws(() => X.resolveInside(root, '02_검토대상/x.pdf', { under: '01_원자료' }), X.RecordsPathError);
  });
  await t('a junction inside the project that points outside is never followed (resolve, write, mkdir)', () => {
    const root = tmp(), outside = tmp();
    if (!tryLink(outside, path.join(root, 'j'), 'junction')) { return 'skip'; }
    assert.throws(() => X.resolveInside(root, 'j/x.txt'), /link or junction/);
    assert.throws(() => X.writeExclusive(root, path.join(root, 'j', 'x.txt'), 'x'), /link or junction/);
    assert.throws(() => X.mkdirInside(root, path.join(root, 'j', 'd')), /link or junction/);
    assert.deepStrictEqual(fs.readdirSync(outside), []);
  });
  await t('a file symlink is not read and not written through', () => {
    const root = tmp(), outside = tmp();
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'S');
    if (!tryLink(path.join(outside, 'secret.txt'), path.join(root, 'l.txt'), 'file')) { return 'skip'; }
    assert.throws(() => X.readBounded(path.join(root, 'l.txt'), 100), /link/);
    assert.throws(() => X.writeAtomic(root, path.join(root, 'l.txt'), 'x'), /link/);
    assert.strictEqual(fs.readFileSync(path.join(outside, 'secret.txt'), 'utf8'), 'S');
  });
  await t('writeExclusive never overwrites; writeAtomic leaves no temp file when it fails', () => {
    const root = tmp();
    X.writeExclusive(root, path.join(root, 'a.json'), '1');
    assert.throws(() => X.writeExclusive(root, path.join(root, 'a.json'), '2'), /EEXIST/);
    fs.mkdirSync(path.join(root, 'dir.json'));
    assert.throws(() => X.writeAtomic(root, path.join(root, 'dir.json'), 'x'));
    X.writeAtomic(root, path.join(root, 'a.json'), '3');
    assert.strictEqual(fs.readFileSync(path.join(root, 'a.json'), 'utf8'), '3');
    assert.deepStrictEqual(fs.readdirSync(root).filter((n) => n.includes('.tmp-')), []);
  });
  await t('readBounded refuses folders and files over the limit', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'big'), Buffer.alloc(101));
    assert.throws(() => X.readBounded(path.join(root, 'big'), 100), /larger/);
    assert.throws(() => X.readBounded(root, 100), /not a plain file/);
    assert.strictEqual(X.readBounded(path.join(root, 'none'), 100), null);
  });

  // ── 프로젝트 · 선언 ─────────────────────────────────────────────
  await t('createProject writes the declaration once (wx) and the four fixed folders; the name rules apply', () => {
    const root = tmp();
    const { dir, decl } = P.createProject(root, '물류창고 지붕'.normalize('NFD'), { now: '2026-11-24T10:00:00+09:00', version: '0.1' });
    assert.strictEqual(path.basename(dir), '물류창고 지붕'.normalize('NFC'));
    assert.match(decl.projectId, P.PROJECT_ID_RE);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['01_원자료', '02_검토대상', '03_계산서', '04_발행본', 'stcfsd-project.json'].sort());
    const r = P.readDeclaration(dir);
    assert(r.ok && !r.readOnly && r.decl.projectId === decl.projectId);
    assert.throws(() => P.createProject(root, '물류창고 지붕'.toUpperCase(), { now: '', version: '' }), /already exists/);
    assert.throws(() => P.createProject(root, 'MOO 지붕', { now: '', version: '' }) && P.createProject(root, 'moo 지붕', { now: '', version: '' }), /already exists/);
    for (const bad of ['..', 'a/b', 'CON', '.x', 'x.']) { assert.throws(() => P.createProject(root, bad, { now: '', version: '' }), P.RecordsPathError || Error); }
    assert.deepStrictEqual(fs.readdirSync(root).sort(), ['MOO 지붕', '물류창고 지붕'].sort());
  });
  await t('crafted declaration: folder roles / paths / unknown keys are ignored — writes still go to the fixed folders', () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'stcfsd-project.json'), JSON.stringify({ schema: 'stcfsd-project/1', projectId: 'pabcdefghijklmnop', name: 'x',
      folders: { cases: 'C:\\Windows\\System32', issued: '..\\..' }, mcpServers: { evil: {} }, hooks: {} }));
    const r = P.readDeclaration(root);
    assert(r.ok);
    assert.deepStrictEqual(Object.keys(r.decl).sort(), ['createdAt', 'createdBy', 'name', 'projectId', 'schema']);
    assert.strictEqual(r.warnings.length, 3);
    fs.mkdirSync(path.join(root, '02_검토대상'));
    assert.strictEqual(P.caseFileFor(root, '퍼린 P1').rel, '02_검토대상/퍼린 P1.csd');
    assert.throws(() => P.caseFileFor(root, '..\\..\\Windows\\x'), Error);
  });
  await t('declaration: not JSON / wrong schema / bad id / no name / too large / a link / a folder → not a project; higher major → read-only', () => {
    const root = tmp();
    const decl = path.join(root, 'stcfsd-project.json');
    const cases = [['{', /not JSON/], ['[]', /not an object/], ['{"schema":"x/1"}', /schema/], ['{"schema":"stcfsd-project/1","projectId":"p1","name":"a"}', /projectId/],
      ['{"schema":"stcfsd-project/1","projectId":"pabcdefghijklmnop"}', /name/], [JSON.stringify({ schema: 'stcfsd-project/1', projectId: 'pabcdefghijklmnop', name: 'a', pad: 'x'.repeat(17000) }), /larger/]];
    for (const [text, re] of cases) { fs.writeFileSync(decl, text); const r = P.readDeclaration(root); assert(!r.ok && re.test(r.error), `${text.slice(0, 30)} → ${r.error}`); }
    fs.writeFileSync(decl, '\uFEFF' + JSON.stringify({ schema: 'stcfsd-project/2', projectId: 'pabcdefghijklmnop', name: 'a' }));
    const r = P.readDeclaration(root);
    assert(r.ok && r.readOnly === true);
    fs.unlinkSync(decl); fs.mkdirSync(decl);
    assert.strictEqual(P.readDeclaration(root).ok, false);
    assert.strictEqual(P.findProjectFor(path.join(root, '02_검토대상', 'x.csd')), null);
  });
  await t('findProjectFor looks up two levels and marks files under 04_발행본 as issued', () => {
    const root = tmp();
    const { dir } = P.createProject(root, 'p', { now: '', version: '' });
    assert.deepStrictEqual(P.findProjectFor(path.join(dir, '02_검토대상', 'a.csd')), { dir, issued: false });
    assert.deepStrictEqual(P.findProjectFor(path.join(dir, '04_발행본', 'a', 'R0', 'a.csd'), 3), { dir, issued: true });
    assert.strictEqual(P.findProjectFor(path.join(dir, 'x', 'y', 'z', 'a.csd'), 2), null);
    assert.strictEqual(P.findProjectByName(root, 'P'), dir);
    assert.strictEqual(P.findProjectByName(root, '../p'), null);
  });

  // ── 작성자 열쇠 · 믿음 ──────────────────────────────────────────
  await t('key: created on first use in the injected folder (wx); the same writer next time; private key never exposed', () => {
    const kd = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(kd);
    assert.match(w.writerId, W.WRITER_RE);
    assert(fs.existsSync(path.join(kd, 'writer.key')));
    assert.strictEqual(W.loadOrCreateWriter(kd).writerId, w.writerId);
    const pem = fs.readFileSync(path.join(kd, 'writer.key'), 'utf8');
    assert.match(pem, /PRIVATE KEY/);
    const dump = JSON.stringify(w) + Object.getOwnPropertyNames(w).join(',') + String(w.sign);
    assert(!/PRIVATE/.test(dump) && !dump.includes(pem.split('\n')[1]), 'private key reachable from the writer object');
    assert.deepStrictEqual(Object.getOwnPropertyNames(w).sort(), ['publicKey', 'sign', 'writerId']);
    assert(Object.isFrozen(w));
    const sig = w.sign('hello');
    assert(W.verifySig(w.publicKey, 'hello', sig) && !W.verifySig(w.publicKey, 'hellO', sig));
  });
  await t('key: an unreadable key file is not replaced (error, bytes unchanged); a replaced valid key is a new writer', () => {
    const kd = path.join(tmp(), 'keys');
    const w1 = W.loadOrCreateWriter(kd);
    const file = path.join(kd, 'writer.key');
    fs.writeFileSync(file, 'garbage');
    assert.throws(() => W.loadOrCreateWriter(kd), W.KeyUnavailableError);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'garbage');
    const { generateKeyPairSync } = require('crypto');
    fs.writeFileSync(file, generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
    assert.throws(() => W.loadOrCreateWriter(kd), /not an Ed25519/);
    fs.writeFileSync(file, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
    assert.notStrictEqual(W.loadOrCreateWriter(kd).writerId, w1.writerId);
    fs.unlinkSync(file); fs.mkdirSync(file);
    assert.throws(() => W.loadOrCreateWriter(kd), W.KeyUnavailableError);
  });
  await t('key: a key folder that is a junction is refused', () => {
    const base = tmp(), real = tmp();
    if (!tryLink(real, path.join(base, 'keys'), 'junction')) { return 'skip'; }
    assert.throws(() => W.loadOrCreateWriter(path.join(base, 'keys')), /not a plain folder/);
    assert.deepStrictEqual(fs.readdirSync(real), []);
  });
  await t('trust: self is trusted on first open; entries whose id does not match the key are dropped; a broken file reads as empty', () => {
    const kd = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(kd);
    const s = W.trustSelf(kd, w, '김OO', '2026-11-24');
    assert.strictEqual(s.writers[w.writerId].by, 'self');
    const raw = JSON.parse(fs.readFileSync(path.join(kd, 'trust.json'), 'utf8'));
    raw.writers.wzzzzzzzzzzzzzzzzzzzz = { publicKey: w.publicKey, name: 'forged', by: 'person' };
    raw.writers[w.writerId].by = 'admin';
    fs.writeFileSync(path.join(kd, 'trust.json'), JSON.stringify(raw));
    assert.deepStrictEqual(Object.keys(W.readTrust(kd).store.writers), []);
    fs.writeFileSync(path.join(kd, 'trust.json'), '{');
    const r = W.readTrust(kd);
    assert(r.broken && Object.keys(r.store.writers).length === 0);
  });
  await t('writer card: self-signed; a changed name or a foreign key fails; person trust adds and removes', () => {
    const kd = path.join(tmp(), 'keys'), kd2 = path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(kd), other = W.loadOrCreateWriter(kd2);
    const card = W.makeWriterCard(other, '이OO', 'PC-2', '2026-11-24');
    assert(W.readWriterCard(JSON.parse(JSON.stringify(card))));
    assert.strictEqual(W.readWriterCard({ ...card, name: '박OO' }), null);
    assert.strictEqual(W.readWriterCard({ ...card, publicKey: w.publicKey }), null);
    assert.strictEqual(W.readWriterCard({ ...card, sig: { w: card.writerId, s: w.sign('x') } }), null);
    W.trustSelf(kd, w, 'me', 'now');
    assert(W.setTrust(kd, card, true, 'now').writers[other.writerId]);
    assert(!W.setTrust(kd, card, false, 'now').writers[other.writerId]);
    assert(W.readTrust(kd).store.writers[w.writerId], 'self is never removed by setTrust');
  });

  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
