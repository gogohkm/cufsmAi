/* global require, process */
// 두 프로세스 시험의 자식 — 같은 프로젝트 · 같은 열쇠 자리에서 다른 대상을 열고 실행 N 개를 기록한다.
//   node _child_desk.js <projectDir> <keyDir> <caseName> <count>
'use strict';
const fs = require('fs');
const { rec } = require('./_harness');
const [projectDir, keyDir, caseName, count] = process.argv.slice(2);
const D = rec('desk');
let clock = 0;
const desk = new D.RecordsDesk({ keyDir, roots: () => [], now: () => new Date(Date.UTC(2026, 10, 24, 12, 0, 0, clock++)).toISOString(),
  host: 'test-host', version: 'test', engineId: () => 'sha256:' + 'e'.repeat(64) });
desk.person.openFolder(projectDir);
const { abs } = desk.openCase(caseName);
const out = desk.afterOpen(abs, fs.readFileSync(abs));
process.send({ readOnly: out.readOnly });
process.on('message', (m) => {
  if (m !== 'go') { return; }
  for (let i = 0; i < Number(count); i += 1) {
    desk.onRun('member_design', `{"child":${i}}`, { pass: true, utilization: i / 100, design_checks: [] }, { actor: { kind: 'person' } });
  }
  desk.dispose();
  process.send({ done: Number(count) });
  process.exit(0);
});
