/* global process */
// R1-2 렌더 증거(기록 설계 §6.1 R1 줄): 프로젝트의 검토 대상을 열고 · 해석하고 · 저장하고 · 닫았다(다른 대상을 열어) 다시 열면
//  ① 화면에 좌굴 해석이 그려져 있고(진짜 웹뷰 — 헤드리스 Edge, 곡선 캔버스에 그린 점), ② get_case_status 가 그 해석을 「일치」로,
//  ③ 마지막 실행의 누가(ai · 클라이언트) · 언제를 실행 기록에서 돌려준다. 이름으로만 연다(경로 없음).
//   node test/rendered/records/run.js      (Edge 또는 Chrome, .venv 파이썬 — 없으면 SKIP 한 줄)
// 임시 폴더만 쓴다(뿌리 · 열쇠 자리를 시험이 준다). 그림: test/rendered/out/records/.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { start, findBrowser } = require('../lib');
const { pythonPath } = require('../../webview/panel_harness');

const OUT = path.join(__dirname, '..', 'out', 'records');

async function main() {
  if (!pythonPath()) { console.log('records rendered: SKIP — no .venv python'); return; }
  if (!findBrowser()) { console.log('records rendered: SKIP — no Edge / Chrome'); return; }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await start({ outDir: OUT, httpPort: 47991, cdpPort: 9491 });
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_r12r_'));
  const S = ctx.StcfsdPanel;
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [path.join(box, 'roots')];
  fs.mkdirSync(S.projectRoots[0]);
  const TOKEN = crypto.randomBytes(32).toString('hex');
  const { McpBridgeServer } = ctx.loadHost(path.join('src', 'mcp', 'bridge.ts'));
  const bridge = new McpBridgeServer(() => ctx.panel, 0, { portFile: path.join(box, 'port'), token: TOKEN });
  await bridge.start();
  let seq = 0;
  const call = (body) => new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: '/action', method: 'POST', headers: {
      Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
      'X-StCFSD-Request-Id': `r-${++seq}`, 'X-StCFSD-Client': 'claude-desktop/0.0-test' } }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(payload); req.end();
  });
  const drawn = () => ctx.eval(`(()=>{const c=document.getElementById('buckling-curve-canvas'); if(!c) return -1;
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; for(let i=3;i<d.length;i+=4){ if(d[i]>0) n++; } return n;})()`);
  // 그린 점이 생길 때까지(화면은 해석을 받은 뒤 설계용 FSM 준비 · 탭 전환을 이어 한다) — 10 초까지
  const drawnSoon = async () => { let n = -1; for (let i = 0; i < 50; i++) { n = await drawn(); if (n > 500) { break; } await new Promise((r) => setTimeout(r, 200)); } return n; };
  const status = () => ctx.eval(`String((document.getElementById('analysis-status')||{}).textContent||'')`);
  const out = [];
  try {
    await call({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await call({ action: 'set_lengths', lengths: [5, 10, 20, 40, 80, 160] });
    assert(!(await call({ action: 'open_project', name: '물류창고 지붕', create: true })).error);
    for (const n of ['A', 'B']) { assert(!(await call({ action: 'new_case', name: n, kind: 'roof-purlin' })).error); }
    assert.strictEqual((await call({ action: 'open_case', name: 'A' })).opened, 'A');
    let m = ctx.mark();
    const ra = await call({ action: 'run_analysis' });
    assert(!ra.error, JSON.stringify(ra).slice(0, 200));
    await ctx.waitMsg('analysisComplete', m.h2w, 300000);
    await ctx.settle(600);
    const atRun = await drawnSoon();
    assert(atRun > 500, `the curve is drawn after the run (${atRun} px)`);
    const sv = await call({ action: 'save_case' });
    assert(!sv.error && sv.saved === 'A', JSON.stringify(sv));
    // 닫기 = 다른 대상을 연다 — 화면의 결과가 지워진다
    m = ctx.mark();
    assert.strictEqual((await call({ action: 'open_case', name: 'B' })).opened, 'B');
    await ctx.waitMsg('resultsCleared', m.h2w, 60000);
    await ctx.settle(600);
    const onB = await call({ action: 'get_case_status' });
    assert(!onB.results.buckling_analysis || onB.results.buckling_analysis.state !== 'match', 'B has no matching analysis');
    await ctx.shot('01-case-B');
    // 다시 연다
    m = ctx.mark();
    const oa = await call({ action: 'open_case', name: 'A' });
    assert.strictEqual(oa.opened, 'A');
    await ctx.waitMsg('analysisComplete', m.h2w, 60000);
    await ctx.settle(800);
    const px = await drawnSoon();
    const st = await status();
    assert(px > 500, `the reopened case draws its curve (${px} px)`);
    // 화면은 해석을 받으면 설계용 FSM 을 스스로 준비한다 — 그 뒤의 띠도 해석이 있다는 뜻
    assert(/Analysis complete|설계용 FSM 준비 완료/.test(st), `the status bar says the analysis is there: '${st}'`);
    await ctx.shot('02-case-A-reopened');
    const cs = await call({ action: 'get_case_status', detail: 'runs' });
    const bk = cs.results.buckling_analysis;
    assert.strictEqual(bk.state, 'match', 'matching ' + JSON.stringify(bk));
    assert.deepStrictEqual([bk.last_run.by, bk.last_run.client], ['ai', 'claude-desktop/0.0-test'], 'who');
    assert(/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(bk.last_run.at), 'when');
    const runRow = cs.runs.find((r) => r.kind === 'buckling_analysis');
    assert(runRow && runRow.at === bk.last_run.at && runRow.engine === bk.last_run.engine, 'the runs detail is the same run');
    assert(!JSON.stringify(cs).includes(box), 'no path in the status');
    out.push(`curve ${atRun} px at the run, ${px} px after reopening; '${st.slice(0, 40)}'; buckling ${bk.state} by ${bk.last_run.by} (${bk.last_run.client}) at ${bk.last_run.at}`);
    if (ctx.log.exceptions.length) { throw new Error('page exceptions: ' + JSON.stringify(ctx.log.exceptions).slice(0, 400)); }
  } finally {
    try { bridge.stop(); } catch { /* */ }
    await ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`records rendered: PASS (${out.join('; ')})`);
}
main().catch((e) => { console.error('records rendered: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
