// W3 (2026-11-22 묶음 2): 판정 3상태(true / false / null) 표시 계약.
// - utils.js 공통 판정 헬퍼 단위 시험 (null 은 OK 가 아니다, NG 가 미평가를 이긴다)
// - app.js 가 판정을 스스로 정하지 않고 공통 헬퍼를 쓰는지 소스 tripwire
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function readUtf8(relPath) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', relPath), 'utf8');
}

function testHelpers() {
  const u = require('../../webview/js/utils.js');
  for (const fn of ['verdictOf', 'combineVerdicts', 'notEvaluatedList', 'warningsList', 'ratioWithVerdict']) {
    assert.strictEqual(typeof u[fn], 'function', `utils.js must export ${fn}`);
  }
  const v = u.verdictOf;

  // 단일 판정
  assert.strictEqual(v({ pass: true }).state, 'PASS');
  assert.strictEqual(v({ pass: false }).state, 'FAIL');
  assert.strictEqual(v({ pass: null }).state, 'NOT_CHECKED', 'null pass is no verdict');
  assert.strictEqual(v({}).state, 'NOT_CHECKED', 'missing pass is no verdict');
  assert.strictEqual(v(null).state, 'NOT_CHECKED');
  assert.strictEqual(v(undefined).state, 'NOT_CHECKED');
  assert.strictEqual(v({ error: 'x', pass: true }).state, 'NOT_CHECKED', 'error result is never OK');
  assert.strictEqual(v({ pass: true, verification_complete: false }).state, 'NOT_CHECKED',
    'incomplete verification is not OK');
  assert.strictEqual(v({ pass: false, verification_complete: false }).state, 'FAIL', 'fail wins');
  assert.strictEqual(v(true).state, 'PASS');
  assert.strictEqual(v(false).state, 'FAIL');
  // 낮은 이용률이어도 pass null 이면 OK 가 아니다
  assert.strictEqual(v({ pass: null, utilization: 0.2 }).state, 'NOT_CHECKED');
  // 표시 문구: 판정 없음은 OK 문구·녹색이 아니다
  const nc = v({ pass: null });
  assert(!/OK/.test(nc.label) && !/OK/.test(nc.short), 'NOT_CHECKED label must not say OK');
  assert.notStrictEqual(nc.color, v({ pass: true }).color, 'NOT_CHECKED colour differs from OK');
  assert.strictEqual(nc.cls, 'warn');

  // 결합
  const c = u.combineVerdicts;
  assert.strictEqual(c([{ pass: true }, { pass: true }]).state, 'PASS');
  assert.strictEqual(c([{ pass: true }, { pass: null }]).state, 'NOT_CHECKED');
  assert.strictEqual(c([{ pass: null }, { pass: false }]).state, 'FAIL', 'fail anywhere -> NG');
  assert.strictEqual(c([{ pass: true }, { error: 'boom' }]).state, 'NOT_CHECKED', 'error counts as unevaluated');
  assert.strictEqual(c([]).state, 'NOT_CHECKED', 'nothing checked is no verdict');
  assert.strictEqual(c([true, false, null]).state, 'FAIL');

  // 미평가 목록: 문자열과 접합부식 {name, reason} 모두, not_evaluated_relevant 우선 + 중복 제거
  const ne = u.notEvaluatedList({
    not_evaluated_relevant: [{ name: 'Screw Shear (J4.3.2)', reason: 'Pnvs 미입력' }],
    not_evaluated: [
      { name: 'Screw Shear (J4.3.2)', reason: 'Pnvs 미입력' },
      'D3 rupture (Fu not given)',
    ],
  });
  assert.deepStrictEqual(ne, ['Screw Shear (J4.3.2) — Pnvs 미입력', 'D3 rupture (Fu not given)']);
  assert.deepStrictEqual(u.notEvaluatedList(null), []);
  assert.deepStrictEqual(u.notEvaluatedList({ checks_not_evaluated: ['G2', 'H2'] }), ['G2', 'H2']);

  // 경고 목록
  assert.deepStrictEqual(u.warningsList({ warnings: ['a', 'a', 'b'], dsm_warning: 'c' }), ['a', 'b', 'c']);
  assert.deepStrictEqual(u.warningsList(undefined), []);

  // 비 + 판정
  assert.strictEqual(u.ratioWithVerdict(0.5, { pass: null }), '50.0% 판정 없음');
  assert.strictEqual(u.ratioWithVerdict(1.2, { pass: false }), '120.0% NG');
}

function testAppTripwires() {
  // K3-1: 검증 · 보고서 함수는 webview/js/review.js(화면 · 호스트가 같이 쓰는 모듈)로 옮겼다 — 같은 글을 둘에서 찾는다
  const appJs = readUtf8(path.join('webview', 'js', 'app.js')) + String.fromCharCode(10) + readUtf8(path.join('webview', 'js', 'review.js'));

  // 판정 규칙은 utils.js 한 곳 — app.js 안의 사본 금지
  assert(!appJs.includes('function _verdictOf('), 'app.js must not define its own _verdictOf');
  assert(!/const verdictOf = \(/.test(appJs), 'app.js must not define an inline verdictOf rule');
  assert(appJs.includes('verdictOf: _v3') && appJs.includes('globalThis.StcfsdUtils'),
    'app.js must import the shared verdict helper');

  // 2상태 판정 패턴 금지 (null 을 OK 또는 NG 로 뭉개는 것)
  const banned = [
    /pass \? 'OK' : 'NG'/,
    /pass\?'OK':'NG'/,
    /\.pass \? '✅/,
    /pass !== false \?/,
    /pass!==false\?/,
    /pass !== false;/,
    /utilization <= 1\.0 \? 'OK'/,
    /utilization<=1\.0\?'pass'/,
    /utilization <= 1\.0 \? 'pass'/,
    /<= 1\.0 \? ' OK' : ' NG'/,
    /lap_ok \? '✅ OK' : '❌ NG'/,
    /\(d\.pass \? 'OK' : 'NG'\)/,
  ];
  for (const re of banned) {
    assert(!re.test(appJs), `app.js must not contain two-state verdict pattern ${re}`);
  }

  // 트리 요약은 3상태
  assert(appJs.includes('passOrFail: d && !d.error ? _v3(d).short'),
    'tree summary passOrFail must be three-state');

  // 퍼린 지배 선택: 종합 판정은 host 결합값(data.pass), 불합격 구간 우선
  // K2(결정 6): 고르기는 utils.js 의 pickGoverningPurlinDesign 하나(화면 · 호스트가 같이 쓴다) — app.js 는 그것을 부른다.
  assert(appJs.includes('globalThis.StcfsdUtils.pickGoverningPurlinDesign(data, _regionLabel)'), 'page picker delegates to the shared function');
  const utilsJs = readUtf8(path.join('webview', 'js', 'utils.js'));
  const pickStart = utilsJs.indexOf('function pickGoverningPurlinDesign(');
  assert(pickStart > 0, 'purlin picker must exist');
  const pick = utilsJs.slice(pickStart, utilsJs.indexOf('\n    }\n', pickStart));
  assert(pick.includes('verdictOf(c.result).state'), 'purlin picker uses the three-state verdict');
  assert(pick.includes('pass: combinedPass'), 'purlin picker must carry the combined three-state pass');
  assert(pick.includes("? data.pass"), 'purlin picker must take the host combined pass');
  assert(pick.includes("state === 'FAIL'"), 'purlin picker must prefer failing regions');
  assert(pick.includes('data.regions'), 'purlin picker must read the per-region list');

  // 검증 대시보드: 판정 없음은 통과가 아니다
  assert(appJs.includes("function _statusFromVerdict(v, ratio)"), 'validation status helper must exist');
  const sfv = appJs.slice(appJs.indexOf('function _statusFromVerdict('), appJs.indexOf('function _statusFromVerdict(') + 300);
  assert(sfv.includes("if (v.state !== 'PASS') { return 'warn'; }"), 'NOT_CHECKED maps to warn');
  assert(appJs.includes("item: '종합 판정 (엔진)'"), 'validation must include the engine overall verdict');

  // 판정 옆에 경고 · 미평가 목록
  assert(appJs.includes('function _verdictListsHtml('), 'verdict list renderer must exist');
  // K3-7: 보고서의 요약은 데이터(_docSummary) — 알림 목록은 _noticeBlocks(엔진 글 그대로, 그리기가 이스케이프)
  { const st = appJs.indexOf('function _docSummary('); assert(st > 0, '_docSummary must exist');
    assert(appJs.slice(st, appJs.indexOf('\n        function ', st + 10)).includes('_noticeBlocks('), 'the report summary shows warnings / not-evaluated next to the verdict'); }
  for (const fn of ['renderLapConnectionResult', 'renderConnectionResult', 'renderDesignResult']) {
    const start = appJs.indexOf('function ' + fn + '(');
    assert(start > 0, fn + ' must exist');
    const end = appJs.indexOf('\n    function ', start + 10);
    const body = appJs.slice(start, end > 0 ? end : undefined);
    assert(body.includes('_verdictListsHtml('), fn + ' must show warnings / not-evaluated next to the verdict');
  }

  // 낡은 문구 제거
  assert(!appJs.includes('Chen & Moen'), 'kphi method label must not say Chen & Moen');
  assert(!appJs.includes('R=0.60은 기본값'), 'there is no default R = 0.60 any more');
}

function main() {
  testHelpers();
  testAppTripwires();
  console.log('verdict_display_contract: PASS');
}

if (require.main === module) {
  main();
}

module.exports = { main };
