/* global require, process */
// 열쇠를 처음 만드는 순간이 겹치는 시험(V7-28)의 자식 — 신호를 받으면 같은 열쇠 자리에서 열쇠를 읽거나 만들고 작성자 id 를 알린다.
'use strict';
const { rec } = require('./_harness');
const W = rec('writer');
process.on('message', (m) => {
  if (m !== 'go') { return; }
  try { process.send({ id: W.loadOrCreateWriter(process.argv[2]).writerId }); } catch (e) { process.send({ error: String(e && e.message) }); }
  process.exit(0);
});
process.send({ ready: true });
