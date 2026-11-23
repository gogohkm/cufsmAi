/* global process */
// V9a-01 · S1 — 발행 · 초안이 두 상태를 섞지 않는다(최종 검증 V9a: 발행 중 AI 의 설계 한 번으로 R0 의 검증표가 불합격 상태를, 계산서는 확인한 통과 상태를 실었다).
// 진짜 패널 · 파이썬 · MCP 다리 · 진짜 MCP 서버(소스) · 진짜 인쇄. 열쇠 · 프로젝트는 임시 폴더.
//  ① 발행 중(점검을 지난 뒤 · 인쇄마다 · 목록 앞)에 AI 가 aisi_design_flexure {Mu 75}(불합격) — 발행 중이면 code 와 함께 거절되고,
//     어느 때든 묶음의 모든 파일이 점검한 상태(Mu 40 · 통과)의 것이다. 발행 뒤의 요청은 받는다.
//  ② 거절을 지나친 길(호스트 안에서 바로 입력을 바꿈)이 인쇄 중에 끼면 — 쓴 뒤 다시 한 점검이 달라 실패한 발행(세지 않음), 차수는 그대로
//  ③ 초안을 인쇄하는 동안 상태가 바뀌면 — 초안의 근거는 그 내용을 지은 상태(그래서 「낡음」), 내용은 Mu 40
// e622857 에서는 ① 의 첫 경우(점검 직후)에 R0 의 검증표가 115.6 %(불합격)를 싣는다 — 이 시험이 실패한다.
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');
const { transpileMcp } = require('./mcp_transpile');

const ROOT = path.join(__dirname, '..', '..');
const TOKEN = crypto.randomBytes(32).toString('hex');
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('records_issue_race_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_race_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
  const { McpBridgeServer } = ctx.load(path.join('src', 'mcp', 'bridge.ts'));
  const portFile = path.join(box, 'mcp', 'stcfsd-mcp-port');
  const bridge = new McpBridgeServer(() => p, 0, { portFile, token: TOKEN });
  await bridge.start();
  const mdir = path.join(box, 'mcpjs');
  transpileMcp(mdir, ['server', 'siUnits', 'bridge', 'portFile', 'hostConnection', 'recordTools']);
  const { Client } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'index.js'));
  const { StdioClientTransport } = require(path.join(ROOT, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'cjs', 'client', 'stdio.js'));
  const env = { ...process.env, STCFSD_MCP_PORT_FILE: portFile, STCFSD_MCP_STANDALONE: '1', NODE_PATH: path.join(ROOT, 'node_modules') };
  delete env.STCFSD_MCP_PORT;
  const client = new Client({ name: 'race-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const raw = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, text };
  };
  const tool = async (name, args) => {
    const r = await raw(name, args);
    if (r.isError || (r.data && r.data.error)) { throw new Error(`${name}: ${r.text.slice(0, 300)}`); }
    return r.data;
  };
  const face = () => p.recordsPerson;
  try {
    await tool('open_project', { name: 'V9', create: true });
    await tool('new_case', { name: 'Beam', kind: 'section-only' });
    await tool('open_case', { name: 'Beam' });
    const pdir = fs.realpathSync.native(path.join(root, 'V9'));
    const issueRoot = path.join(pdir, '04_발행본', 'Beam');
    const flex = (Mu) => tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu, Vu: 1 });
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
    await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await tool('run_analysis', {});
    await flex(40);
    // 막는 것을 모두 푼다: 가정 확정 + 사람의 확인, 검토 항목 확인, 저장, 초안
    const ready = async () => {
      for (const a of (await tool('assumptions', { action: 'list', include_others: true })).items.filter((x) => !x.closed && x.blocks_issue)) {
        if (a.status === 'provisional') { await tool('assumptions', { action: 'update', item: a.item, status: 'firm' }); }
        face().review({ mark: true, targets: [{ type: 'assumption', id: a.item, shown: p._desk.assumptionItems().find((x) => x.item === a.item).lastSeq }] });
      }
      const todo = (await tool('get_reviews', { type: 'check' })).items.filter((x) => x.type === 'check' && x.state !== 'reviewed');
      if (todo.length) { face().review({ mark: true, targets: todo.map((x) => ({ type: 'check', key: x.key, shown: x.fp })) }); }
      await tool('save_case', {});
      await tool('generate_report', { format: 'html' });
      const c = await tool('documents', { action: 'check' });
      assert.strictEqual(c.blocked, false, 'ready to issue: ' + JSON.stringify(c.blockers));
    };
    const bundleOf = (label) => {
      const dir = path.join(issueRoot, label);
      const read = (n) => fs.readFileSync(path.join(dir, n), 'utf8');
      return { calc: read(`Beam.calc.${label}.html`), validation: read(`Beam.validation.${label}.html`), man: JSON.parse(read('manifest.json')) };
    };
    // 점검한 상태(Mu 40 · 통과)의 묶음인가 — 계산서 · 검증표 · 목록이 같은 상태
    // 검증표의 머리 줄은 미리보기 때 호스트의 검증 항목 수와 같아야(실행을 적지 않는 호스트 안의 계산)
    const countsLine = () => {
      const items = p._validationItems(p._reviewEnv('US'));
      const n = (st) => items.filter((c) => c.status === st).length;
      return `검증 항목 ${items.length} — 통과 ${n('pass')} · 주의 ${n('warn')} · 실패 ${n('fail')}`;
    };
    const consistent = (label, why, expectLine) => {
      const b = bundleOf(label);
      assert(/Mu = 40\.00 kip-in/.test(b.calc), `${why}: the calculation report is the checked state (Mu 40)`);
      const got = (b.validation.match(/검증 항목 \d+ — 통과 \d+ · 주의 \d+ · 실패 \d+/) || [''])[0];
      assert(got === expectLine && !/115\.6\s*%/.test(b.validation), `${why}: the validation table is the checked state — ${got} (expected ${expectLine})`);
      return b;
    };

    // ════ ① 발행 중 AI 의 설계(불합격) — 때마다 ════
    const points = ['folder', 'print:pdf', 'print:buckling-pdf', 'print:validation-pdf', 'manifest'];
    let rev = 0;
    for (const point of points) {
      await ready();
      const pv = face().issuePreview();
      const expectLine = countsLine();
      let fired = null;
      S.__issueFault = (step) => { if (step === point && !fired) { fired = raw('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu: 75, Vu: 1 }); } };
      const iss = await face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce });
      S.__issueFault = null;
      assert(fired, `${point}: the interleaved request was fired`);
      const r = await fired;
      const label = `R${rev}`;
      assert.strictEqual(iss.item, label);
      consistent(label, point, expectLine);
      const refused = r.isError || (r.data && r.data.error);
      if (refused) {
        assert(/being written|host\.issue\.in-progress/.test(r.text), `${point}: refused with the reason: ${r.text.slice(0, 200)}`);
      }
      notes.push(`${point}: R${rev} = the checked state; the AI's design ${refused ? 'refused (in progress)' : 'ran after the issue'}`);
      // 다음 차례 — 같은 상태로 되돌린다(같은 바이트 → 확인 그대로)
      await flex(40);
      rev += 1;
    }
    const dl = await tool('documents', { action: 'list' });
    assert(dl.issues.length === points.length && dl.issues.every((x) => x.state === 'same'), 'every issue listed, unchanged');

    // ════ ② 거절을 지나친 길 — 쓴 뒤 다시 한 점검이 다르다 → 실패한 발행 ════
    await ready();
    let pv = face().issuePreview();
    S.__issueFault = (step) => { if (step === 'print:pdf') { void p._caseSetInputs({ inputs: { Cb: 1.2 }, reason: 'bypass' }); } };
    await assert.rejects(face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }), (e) => e.code === 'host.issue.changed-during' && /failed issue/.test(e.message),
      'a change that bypassed the refusal: the re-check fails the issue');
    S.__issueFault = null;
    const dl2 = await tool('documents', { action: 'list' });
    assert(dl2.issues.length === points.length && dl2.failed && dl2.failed.some((x) => x.label === `R${rev}`), 'not counted — a failed issue: ' + JSON.stringify(dl2.failed));
    assert(!fs.existsSync(path.join(issueRoot, `R${rev}`, 'manifest.json')), 'no manifest in the failed folder');
    notes.push(`a state change that bypassed the refusal during the print: the re-check failed the issue (host.issue.changed-during), R${rev} not counted`);

    // ════ ③ 초안 — 인쇄하는 동안 바뀐 상태 ════
    await tool('set_case_inputs', { inputs: { Cb: 1 } });
    await flex(40);
    await ready();
    let firedD = null;
    S.__issueFault = (step) => { if (step === 'draft-print' && !firedD) { firedD = raw('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu: 75, Vu: 1 }); } };
    const dr = await tool('generate_report', {});       // html + pdf(인쇄)
    S.__issueFault = null;
    assert(firedD, 'the draft print point was reached');
    await firedD;
    const html = fs.readFileSync(path.join(pdir, ...dr.files.find((f) => f.endsWith('.html')).split('/')), 'utf8');
    const drow = (await tool('documents', { action: 'list' })).drafts.find((x) => x.item === dr.draft);
    assert(/Mu = 40\.00 kip-in/.test(html) && drow.state === 'stale' && drow.stale_because.some((w) => /results|inputs/.test(w)),
      'the draft\'s basis is the state its content was drawn from (Mu 40) — after the change it reads stale: ' + JSON.stringify(drow));
    notes.push(`draft printed while the AI designed Mu 75: content Mu 40, basis = that state → ${drow.state} (${drow.stale_because.join(', ')})`);
    pv = null;
  } finally {
    S.__issueFault = null;
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  console.log(`records_issue_race_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('records_issue_race_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
