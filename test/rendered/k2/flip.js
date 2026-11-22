/* global process */
// K2 — 고정값을 일부러 바꿀 때 그 까닭을 항목 옆에 남긴다(run.js --accept 로 값을 받아들인 뒤).
//   node test/rendered/k2/flip.js <golden> <id> <expect: pin|k2-change|defect> "<까닭>" [<단계>]
// 항목에 { expect, reason, flipped: [{ step, from, reason, date }] } 를 적는다 — 처음의 까닭(가진 것)은 flipped 의 from 에 남는다.
'use strict';
const fs = require('fs');
const path = require('path');

const [name, id, expect, reason, step] = process.argv.slice(2);
if (!name || !id || !['pin', 'k2-change', 'defect'].includes(expect) || !reason) {
  console.error('usage: node test/rendered/k2/flip.js <golden> <id> <pin|k2-change|defect> "<reason>" [<step>]');
  process.exit(2);
}
const file = path.join(__dirname, 'golden', name + '.json');
const g = JSON.parse(fs.readFileSync(file, 'utf8'));
const e = g.entries.find((x) => x.id === id);
if (!e) { console.error(`no entry ${id} in ${name}`); process.exit(1); }
const before = { expect: e.accepted_from || e.expect, reason: e.reason || null };
delete e.accepted_from;
e.flipped = [...(e.flipped || []), { step: step || null, from: before, date: new Date().toISOString().slice(0, 10) }];
e.expect = expect;
e.reason = reason;
fs.writeFileSync(file, JSON.stringify(g, null, 1) + '\n');
console.log(`${name} :: ${id} → ${expect} (${reason.slice(0, 80)})`);
