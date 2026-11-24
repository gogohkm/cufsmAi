/* global process */
// R1-3 화면 7 — 접합부 탭의 카드(랩 · 단일 접합 — 같은 자리)가 단위 단추를 누르면 새 단위로 다시 그려진다(전: 다음 실행까지 옛 단위).
//   node test/rendered/connection_units.js   (Edge 또는 Chrome, .venv 파이썬 — 없으면 SKIP 한 줄)
// 진짜 호스트 · 파이썬 · 웹뷰(헤드리스). 지운 카드(낡음)는 단위를 바꿔도 되살아나지 않는다.
// 카드의 결과 줄을 본다 — 엔진의 계산 과정 글은 US 로 쓴 식이라고 카드가 밝힌다(보지 않는다).
'use strict';
const assert = require('assert');
const path = require('path');
const { start, findBrowser } = require('./lib');
const { startMcp } = require('./mcp');
const { pythonPath } = require('../webview/panel_harness');

const OUT = path.join(__dirname, 'out', 'connection_units');
const SI_NUM = /\d\s?(mm|kN)\b/;
const US_NUM = /\d\s?(in|kips)\b/;
const LAP_ROW = /Lap 길이 검증.{0,30}/;
const CONN_ROW = /설계강도 \(φRn\).{0,20}/;

async function main() {
  if (!pythonPath()) { console.log('connection_units: SKIP — no .venv python'); return; }
  if (!findBrowser()) { console.log('connection_units: SKIP — no Edge / Chrome'); return; }
  const ctx = await start({ outDir: OUT, httpPort: 47993, cdpPort: 9493 });
  const m = await startMcp(ctx.panel);
  const notes = [];
  const card = () => ctx.eval(`String((document.getElementById('connection-result')||{}).innerText||'')`);
  const toggle = async (u) => { await ctx.click('#btn-unit-' + u); await ctx.settle(500); };
  try {
    await toggle('SI');
    const cases = [
      ['design_lap_connection', { d: 8, t: 0.059, Fy: 55, Fu: 70, lap_left_in: 30, lap_right_in: 42, Mu_support: 60, Vu_support: 1.5, fastener_type: 'bolt',
        fastener_dia: 0.5, n_rows: 2, design_method: 'ASD', Se: 1.5, lap_restrained: true }, 'lapConnectionResult', LAP_ROW],
      ['design_connection', { connection_type: 'screw', design_method: 'LRFD', Fy: 50, Fu: 65, t1: 0.059, t2: 0.059, d: 0.19, n: 4, Pu: 2, Pnvs: 1.2, e: 0.6, s: 1 },
        'connectionResult', CONN_ROW],
    ];
    for (const [tool, args, cmd, row] of cases) {
      const mk = ctx.mark();
      const r = await m.call(tool, args);
      assert(!r.isError, `${tool}: ${r.text.slice(0, 200)}`);
      await ctx.waitMsg(cmd, mk.h2w, 120000);
      await ctx.settle(500);
      const si = await card();
      const rowSI = (si.match(row) || [''])[0];
      assert(SI_NUM.test(rowSI) && !US_NUM.test(rowSI), `${tool} SI row: ${rowSI}`);
      await toggle('US');
      const rowUS = ((await card()).match(row) || [''])[0];
      assert(US_NUM.test(rowUS) && !SI_NUM.test(rowUS), `${tool} US row redrawn after the toggle: ${rowUS}`);
      await ctx.shot(`${tool}-US`);
      await toggle('SI');
      assert.strictEqual(await card(), si, `${tool}: back to SI gives the same card`);
      notes.push(`${tool}: 「${rowSI.trim()}」 → 「${rowUS.trim()}」`);
    }
    // 지운 카드(낡음)는 단위를 바꿔도 되살아나지 않는다 — 단일 접합의 입력을 바꾸면 그 카드가 지워진다
    const sc = await m.call('set_case_inputs', { inputs: { connD: 0.25 } });
    assert(!sc.isError, sc.text.slice(0, 200));
    await ctx.settle(800);
    const cleared = await card();
    assert(/다시 실행/.test(cleared), 'the connection card is cleared: ' + cleared.slice(0, 200));
    await toggle('US');
    const after = await card();
    assert(/다시 실행/.test(after) && !CONN_ROW.test(after), 'a cleared card stays cleared after the toggle: ' + after.slice(0, 200));
    await toggle('SI');
    notes.push('a cleared card stays cleared');
    if (ctx.log.exceptions.length) { throw new Error('page exceptions: ' + JSON.stringify(ctx.log.exceptions).slice(0, 300)); }
  } finally {
    await m.close();
    await ctx.close();
  }
  console.log(`connection_units: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('connection_units: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
