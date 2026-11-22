/* global require, process, console, __dirname */
// npm run test:records — 기록의 순수 모듈(R1-1 · R2-1 · R3-1). 브라우저 · 파이썬 · out/ 없이.
//  - 시험 중에 이 PC 의 진짜 열쇠 자리(%LOCALAPPDATA%\StCFSD\records)가 생기거나 바뀌지 않는다(앞뒤로 본다).
//  - 시험이 만든 임시 폴더를 모두 지우고 남은 것이 없는지 본다. 자식 프로세스는 시험 안에서 끝난다.
//  - src/records 는 vscode 를 쓰지 않고, 기본 열쇠 자리를 고르는 곳은 writer.defaultKeyDir 하나뿐이다.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');

function keyDirState(dir) {
  try {
    const st = fs.statSync(dir);
    return JSON.stringify({ exists: true, mtime: st.mtimeMs, entries: fs.readdirSync(dir).sort() });
  } catch { return JSON.stringify({ exists: false }); }
}

(async () => {
  const realKeyDir = H.rec('writer').defaultKeyDir();
  const before = keyDirState(realKeyDir);
  const tmpBefore = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('stcfsd-rec-')));
  let pass = 0, total = 0, skipped = 0;
  for (const name of ['records_core', 'records_log', 'records_changes', 'records_work']) {
    const r = await require(path.join(__dirname, name + '.js')).run();
    pass += r.pass; total += r.total; skipped += r.skipped;
  }
  H.cleanupTemps();
  const guards = [];
  const guard = (title, fn) => { total += 1; try { fn(); pass += 1; } catch (e) { guards.push(`  FAIL guard :: ${title}\n       ${e.message}`); } };
  guard('the real key folder was not created or changed by the tests', () => assert.strictEqual(keyDirState(realKeyDir), before, realKeyDir));
  guard('no temp folders left behind', () => {
    const left = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('stcfsd-rec-') && !tmpBefore.has(n));
    assert.deepStrictEqual(left, []);
  });
  guard('src/records does not import vscode; only writer.defaultKeyDir reads LOCALAPPDATA', () => {
    const dir = path.join(H.SRC, 'records');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      assert(!/from ['"]vscode['"]|require\(['"]vscode['"]\)/.test(src), `${f} imports vscode`);
      if (f !== 'writer.ts') { assert(!/LOCALAPPDATA|APPDATA|homedir\(/.test(src), `${f} picks a user folder`); }
    }
  });
  for (const g of guards) { console.log(g); }
  console.log(`\ntest:records — ${pass}/${total} passed${skipped ? `, ${skipped} skipped (needs a privilege this account lacks — see SKIP lines)` : ''}`);
  process.exitCode = pass === total ? 0 : 1;
})().catch((e) => { console.error(e); H.cleanupTemps(); process.exitCode = 1; });
