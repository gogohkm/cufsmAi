/* global require, process, setImmediate */
// 두 프로세스가 같은 작성자로 쓰는 시험의 자식 — 부모가 준 프로젝트 · 열쇠 자리에서 줄 N 개를 쓴다.
//   node _child_writer.js <root> <projectId> <keyDir> <count>
'use strict';
const { rec } = require('./_harness');
const [root, projectId, keyDir, count] = process.argv.slice(2);
const W = rec('writer'), L = rec('log'), WK = rec('work');
const w = W.loadOrCreateWriter(keyDir);
const log = new L.RecordLog({ rootReal: root, projectId, spec: WK.WORK_SPEC, host: 'test-host', keyDir });
const stream = log.open(w);
process.send({ stream });
let n = 0;
const step = () => {
  for (let i = 0; i < 5 && n < Number(count); i += 1, n += 1) {
    log.append({ id: `R-${1000 + n}`, event: 'add', actor: { kind: 'ai' }, body: { item: `R-${1000 + n}`, kind: 'report', caseId: null, title: `child ${n}`, body: '', refs: [], items: [] } });
  }
  if (n < Number(count)) { setImmediate(step); } else { log.close(); process.send({ done: n }); process.exit(0); }
};
process.on('message', (m) => { if (m === 'go') { step(); } });
