/* global process */
// K2 0단계 — 입력 목록이 화면 · 저장 표와 맞는지(브라우저 · 파이썬 없이). 새 입력 칸이 생기면 목록과 시험 값이 따라와야 한다.
//   node test/webview/k2_inventory_contract.js
// 보는 것:
//   1. src/webview/StcfsdPanel.ts 의 HTML 에 있는 모든 <input|select|textarea id> 와 app.js 가 만드는 경간 표 칸이 목록에 있다
//   2. designState.FIELDS 의 모든 키가 목록에 같은 .csd 키 · 단위로 있다
//   3. 렌더 시험의 「처음 값과 다른」 값 표(test/rendered/k2/values.js)가 FIELDS 의 모든 키를 덮는다
//   4. 고정값 파일이 있고, 'k2-change' · 'defect' 항목에는 까닭이 적혀 있다
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'implementation', '20261123-k2-input-inventory.json'), 'utf8'));
const DS = require(path.join(ROOT, 'webview', 'js', 'designState.js'));
const V = require(path.join(ROOT, 'test', 'rendered', 'k2', 'values.js'));
const panel = fs.readFileSync(path.join(ROOT, 'src', 'webview', 'StcfsdPanel.ts'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'webview', 'js', 'app.js'), 'utf8');

const byId = new Map(inv.items.map((i) => [i.id, i]));
const fail = [];

// 1. HTML 의 칸
const htmlIds = [...panel.matchAll(/<(?:input|select|textarea)\b[^>]*?\bid="([^"]+)"/g)].map((m) => m[1]);
assert(htmlIds.length > 100, `parsed ${htmlIds.length} controls from the panel HTML`);
for (const id of htmlIds) { if (!byId.has(id)) { fail.push(`control #${id} (StcfsdPanel.ts) is not in the K2 inventory — re-run node test/rendered/k2/inventory.js`); } }
const dynClasses = [...new Set([...app.matchAll(/<(?:input|select)\b[^>]*?class="(span-tbl-[\w-]+)"/g)].map((m) => m[1]))];
assert(dynClasses.length >= 4, 'span table classes found in app.js');
for (const c of dynClasses) { if (!byId.has('.' + c)) { fail.push(`span table control .${c} (app.js) is not in the K2 inventory`); } }
// 그 밖에 app.js 가 id 를 붙여 만드는 입력 칸이 생기면 여기서 보이게
const dynIds = [...app.matchAll(/<(?:input|select|textarea)\b[^>]*?\bid="([^"$]+)"/g)].map((m) => m[1]);
for (const id of dynIds) { if (!byId.has(id)) { fail.push(`control #${id} created by app.js is not in the K2 inventory`); } }

// 2. 저장 표
for (const [key, id, unit] of DS.FIELDS) {
  const it = byId.get(id);
  if (!it) { fail.push(`designState ${key} (#${id}) missing from the inventory`); continue; }
  if (it.csdKey !== key) { fail.push(`#${id}: inventory .csd key ${it.csdKey} ≠ designState ${key}`); }
  if ((it.unit || null) !== (unit || null)) { fail.push(`#${id}: inventory unit ${it.unit} ≠ designState ${unit}`); }
  if (!it.savedInCsd13) { fail.push(`#${id}: designState saves it but the inventory says not saved`); }
}
// 목록의 수 = 지금 화면(HTML 칸 + 경간 표 종류)
const expectCount = new Set(htmlIds).size + dynClasses.length;
if (inv.items.length !== expectCount) { fail.push(`inventory has ${inv.items.length} items, the page has ${expectCount} controls (+ span table kinds)`); }

// 3. 시험 값
for (const [key] of DS.FIELDS) { if (!(key in V.NON_DEFAULT)) { fail.push(`test/rendered/k2/values.js has no non-default value for ${key}`); } }
for (const k of ['spans', 'supports', 'lapsPerSupport']) { if (!(k in V.SPAN_TABLE)) { fail.push(`values.js SPAN_TABLE.${k} missing`); } }
const di = V.designInputs('US');
if (di.spans.length !== V.NON_DEFAULT.nSpans || di.supports.length !== V.NON_DEFAULT.nSpans + 1 || di.lapsPerSupport.length !== V.NON_DEFAULT.nSpans + 1) {
  fail.push('values.js span table size does not match nSpans');
}
if (V.NON_DEFAULT.spanIxIn4.length !== V.NON_DEFAULT.nSpans) { fail.push('values.js spanIxIn4 count ≠ nSpans'); }

// 4. 고정값
const gdir = path.join(ROOT, 'test', 'rendered', 'k2', 'golden');
const need = ['defaults', 'gui-column', 'gui-beam', 'gui-purlin', 'gui-connection', 'mcp-column', 'mcp-beam', 'mcp-purlin', 'mcp-connection',
  'mcp-analysis', 'reload', 'csd-roundtrip', 'csd-model-differs', 'examples'];
let nK2 = 0, nDefect = 0, nAll = 0;
for (const n of need) {
  const f = path.join(gdir, n + '.json');
  if (!fs.existsSync(f)) { fail.push(`golden ${n}.json missing — run npm run test:k2 -- --record`); continue; }
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of g.entries) {
    nAll += 1;
    if (!['pin', 'k2-change', 'defect'].includes(e.expect)) { fail.push(`${n} :: ${e.id} has expect '${e.expect}'`); }
    if (e.expect === 'k2-change') { nK2 += 1; }
    if (e.expect === 'defect') { nDefect += 1; }
    if (e.expect !== 'pin' && !e.reason) { fail.push(`${n} :: ${e.id} is '${e.expect}' without a reason`); }
  }
}

if (fail.length) {
  console.error('k2_inventory_contract: FAIL\n  ' + fail.join('\n  '));
  process.exit(1);
}
console.log(`k2_inventory_contract: PASS (${inv.items.length} inventoried controls = ${new Set(htmlIds).size} HTML + ${dynClasses.length} span-table kinds; `
  + `${DS.FIELDS.length} designState keys; goldens ${need.length} files, ${nAll} entries, ${nK2} k2-change, ${nDefect} defect)`);
