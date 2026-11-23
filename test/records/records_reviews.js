/* global require, module, process */
// R4-1 · R4-3 — 확인 표시(대상 열쇠 · 줄 · 접기 · 유효성 = 확인한 항목과 지금 항목의 비교, D16) · 대안(줄 · 접기 · 비교) · 사본 정리.
'use strict';
const assert = require('assert');
const path = require('path');
const { rec, tmp, suite } = require('./_harness');

async function run() {
  const { t, done } = suite('records_reviews');
  const W = rec('writer'), L = rec('log'), RV = rec('reviews'), AL = rec('alternatives'), RU = rec('runs'), F = rec('fp');
  const PID = 'pabcdefghijklmnop', CASE = 'cabcdefghijklmnop';

  function store(spec, keyDir) {
    const root = tmp();
    const kd = keyDir || path.join(tmp(), 'keys');
    const w = W.loadOrCreateWriter(kd);
    W.trustSelf(kd, w, 'me', 'now');
    const log = new L.RecordLog({ rootReal: root, projectId: PID, spec, host: 'h', keyDir: kd });
    log.open(w);
    const read = () => log.read(W.readTrust(kd).store).lines;
    return { root, keyDir: kd, w, log, read };
  }
  // 엔진 꼴의 검토 항목 하나(국부좌굴 휨)
  const item = (o = {}) => ({
    id: 'member.flexure.local', group: 'flexure', clause: 'F3.2', verdict: 'pass', ratio: 0.8123456789, governs: false,
    demand: { symbol: 'Mu', value: 40, quantity: 'moment', source: { kind: 'user_input', key: 'Mu' } },
    capacity: { symbol: 'φMnℓ', value: 49.2414141, quantity: 'moment' },
    steps: [
      { kind: 'branch', condition: 'λℓ > 0.776', holds: true, equation: 'F3.2.1-2' },
      { expr: 'Mnℓ = …', equation: 'F3.2.1-2', inputs: [
        { symbol: 'Mcrℓ', value: o.Mcrl ?? 87.0512345678, quantity: 'moment', source: { kind: 'buckling_analysis', method: 'fsm_minimum', label: 'FSM' } },
        { symbol: 'Fy', value: o.Fy ?? 50, quantity: 'stress', source: { kind: 'material', key: 'Fy' } },
        ...(o.global ? [{ symbol: 'Mcre', value: o.Mcre ?? 120.123456, quantity: 'moment', source: { kind: 'buckling_analysis', method: 'fsm_minimum' } }] : []),
      ], result: { symbol: 'Mnℓ', value: o.Mnl ?? 54.712682 * (o.k ?? 1), quantity: 'moment' } },
    ],
    ...(o.verdict ? { verdict: o.verdict } : {}),
  });
  const perturb = (it, rel) => JSON.parse(JSON.stringify(it), (k, v) => (typeof v === 'number' && k !== 'value' ? v : typeof v === 'number' ? v * (1 + rel) : v));

  await t('D16: 1e-9 keeps a mark; 1e-5 on a non-global value drops it; 1e-5 is kept when the item uses long-wavelength global values', () => {
    const a = item();
    // 계산된 값만 흔든다(Mcrℓ · Mnℓ — 사람 · 재료 입력은 그대로)
    const shake = (it, rel) => { const x = JSON.parse(JSON.stringify(it)); x.ratio *= 1 + rel; x.capacity.value *= 1 + rel; x.steps[1].inputs[0].value *= 1 + rel; x.steps[1].result.value *= 1 + rel; return x; };
    assert.strictEqual(RV.compareItems(a, shake(a, 1e-9)).same, true, '1e-9 between PCs keeps the mark');
    const d5 = RV.compareItems(a, shake(a, 1e-5));
    assert(!d5.same && d5.tol === 1e-6 && d5.differences.some((x) => x.path === 'ratio' && x.why === 'number'), '1e-5 on a local value: review again ' + JSON.stringify(d5));
    const g = item({ global: true });
    const g5 = RV.compareItems(g, shake(g, 1e-5));
    assert(g5.same && g5.tol === 1e-4, 'an item that uses Mcre (FSM) gets 1e-4');
    assert.strictEqual(RV.compareItems(g, shake(g, 3e-4)).same, false, '3e-4 is still too much');
    void perturb;
  });
  await t('D16: verdict, clause, branch, equations and person / material inputs must be the same exactly', () => {
    const a = item();
    const b1 = item({ verdict: 'fail' });
    assert(RV.compareItems(a, b1).differences.some((x) => x.path === 'verdict' && x.why === 'text'));
    const b2 = JSON.parse(JSON.stringify(a)); b2.steps[0].holds = false;
    assert.strictEqual(RV.compareItems(a, b2).same, false, 'a different branch');
    const b3 = item({ Fy: 50 * (1 + 1e-12) });
    const d3 = RV.compareItems(a, b3);
    assert(!d3.same && d3.differences[0].why === 'input', 'a material input differs by 1e-12: still different (canonical value) ' + JSON.stringify(d3));
    const b4 = JSON.parse(JSON.stringify(a)); b4.demand.value = 40.0000001;
    assert.strictEqual(RV.compareItems(a, b4).differences[0].why, 'input', 'the demand from a person input is exact');
    const b5 = JSON.parse(JSON.stringify(a)); b5.steps[1].equation = 'F3.2.1-1';
    assert.strictEqual(RV.compareItems(a, b5).same, false, 'equation');
  });
  await t('markValidity: same fingerprint fast path, same content after a re-run, not in results, stale, copy missing / damaged', () => {
    const a = item();
    const key = RV.itemKey('member', a, null);
    const m = { key: `check:${CASE}:${key}`, marked: true, target: { type: 'check', caseId: CASE, key, scope: 'member', id: a.id, location: null, combination: null,
      checkFp: F.checkFp(a), runId: 'run-1', resultBlob: 'f'.repeat(64), verdict: 'pass', ratio: a.ratio }, at: 'x', seq: 1, writer: 'w', reviewer: { name: 'k', writerId: 'w' }, engineId: null, status: 'ok' };
    const ok = { ok: true, value: a };
    assert.deepStrictEqual(RV.markValidity(m, { fp: F.checkFp(a), value: a }, () => { throw new Error('not read on the fast path'); }), { state: 'valid', how: 'same-fingerprint' });
    const rerun = JSON.parse(JSON.stringify(a)); rerun.ratio *= 1 + 2e-10;
    assert.deepStrictEqual(RV.markValidity(m, { fp: F.checkFp(rerun), value: rerun }, () => ok), { state: 'valid', how: 'same-content' });
    assert.strictEqual(RV.markValidity(m, null, () => ok).why, 'not-in-current-results');
    assert.strictEqual(RV.markValidity(m, { fp: 'x', value: rerun, stale: true }, () => ok).why, 'result-stale');
    assert.strictEqual(RV.markValidity(m, { fp: 'x', value: rerun }, () => ({ ok: false, error: 'missing' })).why, 'copy-missing');
    assert.strictEqual(RV.markValidity(m, { fp: 'x', value: rerun }, () => ({ ok: false, error: 'damaged' })).why, 'copy-damaged');
    const off = JSON.parse(JSON.stringify(a)); off.ratio *= 1.001;
    const v = RV.markValidity(m, { fp: F.checkFp(off), value: off }, () => ok);
    assert(v.state === 'review-again' && v.why === 'different-values' && v.differences.length >= 1);
    // 가정 · 판단 요청: 그 판(seq)
    const ma = { ...m, key: 'assumption:A-01', target: { type: 'assumption', id: 'A-01', seq: 7 } };
    assert.strictEqual(RV.markValidity(ma, { fp: null, seq: 7 }, () => ok).state, 'valid');
    assert.strictEqual(RV.markValidity(ma, { fp: null, seq: 8 }, () => ok).why, 'changed-since');
  });
  await t('enumerateChecks: purlin per region and check point, lap with fastener_design; keys match fp.checkKey', () => {
    const p = { regions: [{ id: 'negative-2', result: { checks: [{ check_point: 'support 2', design_checks: [item()] }, { check_point: 'M max', design_checks: [item()] }] } }] };
    const ks = RV.enumerateChecks('purlin', p);
    assert.strictEqual(ks.length, 2);
    assert.strictEqual(ks[0].key, F.checkKey({ scope: 'purlin', id: 'member.flexure.local', location: { region: 'negative-2', check_point: 'support 2' }, combination: null }));
    const lap = RV.enumerateChecks('lap', { design_checks: [item()], fastener_design: { design_checks: [{ id: 'conn.screw.shear', verdict: 'pass' }] } });
    assert.deepStrictEqual(lap.map((x) => x.location), [null, { part: 'fastener_design' }]);
  });
  await t('marks: only person lines of trusted writers count; another key → not counted; a tampered line → unverified; unmark wins later', () => {
    const s = store(RV.REVIEWS_SPEC);
    const a = item();
    const key = RV.itemKey('member', a, null);
    const target = { type: 'check', caseId: CASE, key, scope: 'member', id: a.id, location: null, combination: null, checkFp: F.checkFp(a), runId: null, resultBlob: null, verdict: 'pass', ratio: 0.8 };
    const body = RV.prepareReview('mark', [target], { name: '김 검토', writerId: s.w.writerId }, null);
    s.log.append({ id: 'rev-1', event: 'mark', actor: { kind: 'person' }, body });
    assert.throws(() => s.log.append({ id: 'rev-2', event: 'mark', actor: { kind: 'ai' }, body }), /not allowed|actor|policy|refus/i, 'an AI mark line is not written');
    let f = RV.foldReviews(s.read());
    assert.strictEqual(f.marks.get(`check:${CASE}:${key}`).marked, true);
    // 다른 열쇠(믿지 않는 작성자)의 줄 — 같은 줄 파일 자리에 다른 작성자로
    const k2 = path.join(tmp(), 'k2');
    const other = W.loadOrCreateWriter(k2);
    const log2 = new L.RecordLog({ rootReal: s.root, projectId: PID, spec: RV.REVIEWS_SPEC, host: 'h2', keyDir: k2 });
    log2.open(other);
    log2.append({ id: 'rev-3', event: 'unmark', actor: { kind: 'person' }, body: RV.prepareReview('unmark', [target], { name: '남', writerId: other.writerId }, null) });
    f = RV.foldReviews(s.read());
    assert.strictEqual(f.marks.get(`check:${CASE}:${key}`).marked, true, 'an untrusted writer\'s unmark does not count');
    assert(f.uncounted.some((u) => u.status !== 'ok' && u.reviewer === '남'), 'shown as not counted ' + JSON.stringify(f.uncounted) + JSON.stringify(s.read().map((l) => [l.status, l.event, l.actor && l.actor.kind])));
    s.log.append({ id: 'rev-4', event: 'unmark', actor: { kind: 'person' }, body: RV.prepareReview('unmark', [target], { name: '김 검토', writerId: s.w.writerId }, null) });
    assert.strictEqual(RV.foldReviews(s.read()).marks.get(`check:${CASE}:${key}`).marked, false);
    // 바꿔 친 줄 — 서명이 맞지 않는다
    const fs = require('fs');
    const dir = path.join(s.root, '.stcfsd', 'log', 'reviews');
    const file = path.join(dir, fs.readdirSync(dir).find((n) => n.startsWith(s.w.writerId)));
    const txt = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const forged = txt.map((x) => JSON.parse(x)).find((x) => x.event === 'mark' && Array.isArray(x.targets)); forged.seq = 99; forged.targets[0].verdict = 'fail';   // 줄의 몸은 봉투와 같은 자리
    fs.appendFileSync(file, JSON.stringify(forged) + '\n');
    const f2 = RV.foldReviews(s.read());
    assert.strictEqual(f2.marks.get(`check:${CASE}:${key}`).marked, false, 'a forged mark line is not counted');
    // 서명 없는 줄(손으로 쓴 mark)
    const unsigned = { ...forged, seq: 100 }; delete unsigned.sig;
    fs.appendFileSync(file, JSON.stringify(unsigned) + '\n');
    const f3 = RV.foldReviews(s.read());
    assert(f3.marks.get(`check:${CASE}:${key}`).marked === false && f3.uncounted.length >= 2, 'an unsigned mark line is not counted');
  });
  await t('a malformed target is refused (key not matching scope/id/location, bad fingerprint, too many)', () => {
    assert.throws(() => RV.prepareReview('mark', [{ type: 'check', caseId: CASE, key: 'member|x|y|', scope: 'member', id: 'x', checkFp: F.checkFp(1) }], { name: 'k', writerId: 'w' + 'a'.repeat(20) }, null));
    assert.throws(() => RV.prepareReview('mark', [{ type: 'result', caseId: CASE, kind: 'member_design', resultFp: 'nope' }], { name: 'k', writerId: 'w' + 'a'.repeat(20) }, null));
    assert.throws(() => RV.prepareReview('mark', [], { name: 'k', writerId: 'w' + 'a'.repeat(20) }, null));
  });

  // ── 대안 ─────────────────────────────────────────────────────────
  await t('alternatives: keep / rename / drop / undrop by the AI; fold; compare by check key', () => {
    const s = store(AL.ALTERNATIVES_SPEC);
    const write = (prep) => s.log.append({ id: prep.id, event: prep.event, actor: { kind: 'ai' }, body: prep.body });
    const snap = 'a'.repeat(64), blob = 'b'.repeat(64);
    write(AL.prepareAlternative('keep', { caseId: CASE, label: 't 2.3', contentFp: F.contentFp({}, null).contentFp, snapshot: snap, runs: { member_design: { runId: 'run-1', blob } } }, s.read()));
    write(AL.prepareAlternative('keep', { caseId: CASE, contentFp: F.contentFp({ x: 1 }, null).contentFp, snapshot: snap, runs: {} }, s.read()));
    write(AL.prepareAlternative('rename', { item: 'ALT-2', label: 't 2.6' }, s.read()));
    write(AL.prepareAlternative('drop', { item: 'ALT-1' }, s.read()));
    assert.throws(() => AL.prepareAlternative('drop', { item: 'ALT-1' }, s.read()), /already hidden/);
    assert.throws(() => s.log.append({ id: 'ALT-1', event: 'undrop', actor: { kind: 'person' }, body: { item: 'ALT-1' } }), /./, 'the table allows the AI only');
    const alts = AL.foldAlternatives(s.read());
    assert.deepStrictEqual(alts.map((a) => [a.item, a.label, a.dropped]), [['ALT-1', 't 2.3', true], ['ALT-2', 't 2.6', false]]);
    assert.deepStrictEqual(AL.altBlobs(alts[0]).sort(), [snap, blob].sort());
    const mk = (r, v) => ({ design_checks: [{ ...item(), ratio: r, verdict: v }, { id: 'member.shear', verdict: 'pass', ratio: 0.2 }] });
    const c = AL.compareAlternative({ member_design: mk(1.05, 'fail') }, { member_design: mk(0.73, 'pass') }, { alt: 0.81, now: 0.93 });
    assert.strictEqual(c.rows[0].id, 'member.flexure.local', 'the row whose verdict differs comes first');
    assert.deepStrictEqual([c.head.alt.maxRatio, c.head.alt.ng, c.head.now.ng, c.head.alt.A], [1.05, 1, 0, 0.81]);
  });
  await t('pruning: newest 20 per case and kind stay, plus every run a mark or an alternative refers to; shared copies are not removed', () => {
    const runs = [];
    for (let i = 0; i < 30; i += 1) { runs.push({ runId: `run-${i}`, caseId: CASE, kind: 'member_design', blob: i === 3 ? 'k'.repeat(64) : String(i % 10).repeat(64), snapshot: null }); }
    const drop = RU.planPrune(runs, { keepRuns: new Set(['run-2']), keepBlobs: new Set(['k'.repeat(64)]), alreadyPruned: new Set() });
    // 새 것 20 은 0 – 9 의 해시를 모두 쓴다(10 개마다 되풀이) — 지울 것이 없다
    assert.deepStrictEqual(drop, []);
    const runs2 = runs.map((r, i) => ({ ...r, blob: `${(i + 10).toString(16).padStart(2, '0')}`.repeat(32) }));
    const drop2 = RU.planPrune(runs2, { keepRuns: new Set(['run-2']), keepBlobs: new Set(), alreadyPruned: new Set() });
    assert.strictEqual(drop2.length, 9, 'the 10 oldest minus the one a mark keeps');
    assert(!drop2.includes(runs2[2].blob) && !drop2.some((b) => runs2.slice(10).some((r) => r.blob === b)));
  });
  return done();
}
module.exports = { run };
if (require.main === module) { run().then((r) => { process.exitCode = r.pass === r.total ? 0 : 1; require('./_harness').cleanupTemps(); }); }
