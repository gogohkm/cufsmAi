/* global process, Buffer, setTimeout */
// R5-1 · R5-2 — 초안 · 발행 전 점검 · 발행(기록 설계 §2.4.10 · §3.5 · §5.2, 결정 D3 · D4 · D14 · D15).
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스) · 진짜 인쇄(pdf_isolation 과 같은 닫힌 길 — 보이지 않게). 열쇠 · 프로젝트는 임시 폴더.
//  ① 막는 것(D4) — 하나씩 생기고 풀린다: 설계 결과 없음 · 미평가 · NG · 열린 판단 요청 · 임시 가정 · 확인 미완 · 낡은 결과 · 저장 안 함 ·
//     초안 없음 · 낡은 초안 · 기록 손상 · 기록에 없는 발행 폴더
//  ② 발행: 미리보기 → 발행(R0), 그 뒤 모델을 바꿔 저장해도 R0 의 파일 · 해시 그대로, 손으로 고치면 「고쳐짐」
//  ③ ⚔ 미리보기 뒤의 변경 · 지난 숫자 · 다시 쓴 숫자 → 거절, 반쯤 실패(디스크 참) → 「실패한 발행」 · 차수를 두 번 쓰지 않음,
//     AI 는 발행하지 못한다(도구 · 동작 이름 · 진짜 토큰의 직접 POST · MCP 문맥 안의 얼굴)
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createPanel } = require('./panel_harness');
const { transpileMcp } = require('./mcp_transpile');

const ROOT = path.join(__dirname, '..', '..');
const TOKEN = crypto.randomBytes(32).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('records_issue_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_r5_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = path.join(box, 'key'); S.projectRoots = [root];
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
  const DESK = ctx.load(path.join('src', 'records', 'desk.ts'));
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
  const client = new Client({ name: 'r5-test', version: '1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(mdir, 'server.js')], env, stderr: 'pipe' }));
  const raw = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content && r.content[0] && r.content[0].text) || '';
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { isError: !!r.isError, data, text, bytes: Buffer.byteLength(text) };
  };
  const tool = async (name, args) => {
    const r = await raw(name, args);
    if (r.isError || (r.data && r.data.error)) { throw new Error(`${name}: ${r.text.slice(0, 300)}`); }
    return Object.defineProperty(r.data, '__bytes', { value: r.bytes, enumerable: false });
  };
  const post = (urlPath, body) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: urlPath, method: 'POST', headers: {
      Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }));
    req.write(payload); req.end();
  });
  const face = () => p.recordsPerson;
  const sizes = {};
  const blockers = async () => { const c = await tool('documents', { action: 'check' }); sizes.check = Math.max(sizes.check || 0, c.__bytes); return c; };
  const codes = (c) => c.blockers.map((b) => b.code);
  const seen = new Set();
  const expect = async (code, present, why) => {
    const c = await blockers();
    assert.strictEqual(codes(c).includes(code), present, `${why}: blocker '${code}' ${present ? 'present' : 'gone'} — ${JSON.stringify(c.blockers)}`);
    if (present) { seen.add(code); }
    return c;
  };
  try {
    await tool('open_project', { name: 'R5', create: true });
    await tool('new_case', { name: 'Beam', kind: 'section-only' });
    await tool('open_case', { name: 'Beam' });
    const pdir = fs.realpathSync.native(path.join(root, 'R5'));
    const issueRoot = path.join(pdir, '04_발행본', 'Beam');
    const docsLog = () => { const d = path.join(pdir, '.stcfsd', 'log', 'documents'); try { return fs.readdirSync(d).map((n) => fs.readFileSync(path.join(d, n), 'utf8')).join('|'); } catch { return ''; } };
    const flex = (o = {}) => tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, ...o });

    // ════ ① 막는 것 — 하나씩 ════
    let c = await expect('no-design-result', true, 'nothing computed');
    assert(codes(c).includes('no-draft') && codes(c).includes('incomplete-reviews'), 'no draft, no reviews: ' + codes(c));
    seen.add('no-draft'); seen.add('incomplete-reviews');
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
    await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await tool('run_analysis', {});
    await flex({});                                        // Mu 없음 — 강도만(판정 없음)
    await expect('not-evaluated', true, 'no demand');
    await expect('no-design-result', false, 'a design result');
    await flex({ Mu: 200, Vu: 1 });
    await expect('ng', true, 'Mu 200');
    await flex({ Mu: 40, Vu: 1 });
    c = await expect('ng', false, 'Mu 40');
    assert(!codes(c).includes('not-evaluated'), 'all evaluated: ' + codes(c));
    // 열린 판단 요청 → 답 · 사람의 확인
    const q = await tool('work_items', { action: 'add', kind: 'question', title: '체결 간격', options: [{ label: '300' }] });
    await expect('open-questions', true, 'an open question');
    await tool('work_items', { action: 'answer', item: q.item, said: '300 으로', chosen: 0 });
    await expect('open-questions', true, 'answered by the AI only (needs the person)');
    face().review({ mark: true, targets: [{ type: 'work', id: q.item, shown: p._desk.workItems().find((x) => x.item === q.item).lastSeq }] });
    await expect('open-questions', false, 'confirmed by the person');
    // 임시 가정(자동 가정 · AI 의 가정) → AI 가 firm, 사람이 확인
    await tool('assumptions', { action: 'add', text: '데크 체결 간격 300', status: 'provisional' });
    c = await expect('provisional-assumptions', true, 'provisional assumptions');
    for (const a of (await tool('assumptions', { action: 'list', include_others: true })).items.filter((x) => !x.closed)) {
      await tool('assumptions', { action: 'update', item: a.item, status: 'firm' });
    }
    await expect('provisional-assumptions', true, 'firm by the AI only');
    for (const a of p._desk.assumptionItems().filter((x) => !x.closed)) { face().review({ mark: true, targets: [{ type: 'assumption', id: a.item, shown: a.lastSeq }] }); }
    await expect('provisional-assumptions', false, 'confirmed by the person (D7)');
    // 초안 — 없음 → 있음 → 낡음(확인을 더하면 근거가 바뀐다)
    const d1 = await tool('generate_report', { format: 'html' });
    assert(d1.draft === 'D-1' && /^03_계산서\/Beam\.calc\.r\d+\.html$/.test(d1.files[0]) && d1.folder === 'project', 'a draft in 03_계산서: ' + JSON.stringify(d1).slice(0, 300));
    const d1html = fs.readFileSync(path.join(pdir, ...d1.files[0].split('/')), 'utf8');
    assert(/초안 · D-1 · 확인 안 함/.test(d1html) && /검토 기록/.test(d1html) && /전자서명이 아닙니다/.test(d1html) && /가정 \(기록/.test(d1html), 'the draft says it is a draft, what was not checked, and carries the review record with the D15 statement');
    await expect('no-draft', false, 'a draft');
    // 확인 — 모든 검토 항목
    const gr = await tool('get_reviews', { type: 'check' });
    face().review({ mark: true, targets: gr.items.filter((x) => x.type === 'check').map((x) => ({ type: 'check', key: x.key, shown: x.fp })) });
    c = await expect('incomplete-reviews', false, 'every check reviewed');
    assert(codes(c).includes('stale-draft'), 'the reviews changed the basis — the draft is stale: ' + JSON.stringify(c.blockers)); seen.add('stale-draft');
    const d2 = await tool('generate_report', { format: 'html' });
    assert.strictEqual(d2.draft, 'D-2');
    assert(fs.existsSync(path.join(pdir, ...d1.files[0].split('/'))) && d2.files[0] !== d1.files[0], 'the old draft file is not overwritten');
    await expect('stale-draft', false, 'a new draft');
    // 낡은 결과 — 입력이 바뀌면 결과가 지워진다
    await tool('set_case_inputs', { inputs: { Cb: 1.1 } });
    c = await blockers();
    assert(codes(c).includes('no-design-result') || codes(c).includes('stale-results'), 'inputs changed: the result is gone / stale ' + codes(c));
    if (codes(c).includes('stale-results')) { seen.add('stale-results'); }
    await flex({ Mu: 40, Vu: 1 });                         // 같은 입력으로 다시(같은 바이트 — 확인 그대로)
    // 저장 안 함
    await expect('unsaved-changes', true, 'unsaved');
    await tool('save_case', {});
    await expect('unsaved-changes', false, 'saved');
    // 초안이 이제 다른 실행을 가리킨다 → 새 초안(PDF 도 — 진짜 인쇄)
    await tool('generate_report', {});
    // 기록 손상 — 줄 파일 가운데를 깬다
    const wdir = path.join(pdir, '.stcfsd', 'log', 'work');
    const wf = path.join(wdir, fs.readdirSync(wdir).find((n) => n.endsWith('.jsonl')));
    const wkeep = fs.readFileSync(wf);
    const lines = wkeep.toString('utf8').split('\n');
    fs.writeFileSync(wf, [lines[0], '{"broken": tru', ...lines.slice(1)].join('\n'));
    await expect('damaged-records', true, 'a broken line in the records');
    fs.writeFileSync(wf, wkeep);
    await expect('damaged-records', false, 'records repaired');
    // 기록에 없는 발행 폴더
    fs.mkdirSync(path.join(issueRoot, 'R0'), { recursive: true });
    await expect('unknown-issue-folder', true, 'an R0 folder the records do not know');
    {   // 미리보기는 그 막는 것과 함께 보이고, 발행은 거절 — 그 폴더를 다시 쓰지 않는다
      const pvx = face().issuePreview();
      assert(pvx.blockers.some((b) => b.code === 'unknown-issue-folder' && /기록에 없는 발행 폴더/.test(b.text_ko)) && pvx.blockers.every((b) => b.text_ko), 'the preview carries the Korean sentence per code: ' + JSON.stringify(pvx.blockers));
      await assert.rejects(face().issue({ fingerprint: pvx.fingerprint, nonce: pvx.nonce }), (e) => /blocked: .*unknown-issue-folder/.test(e.message) && e.code === 'host.issue.unknown-issue-folder');
      assert.deepStrictEqual(fs.readdirSync(path.join(issueRoot, 'R0')), [], 'the unknown folder is not reused');
    }
    fs.rmSync(path.join(issueRoot, 'R0'), { recursive: true });
    c = await expect('unknown-issue-folder', false, 'removed');
    assert.strictEqual(c.blocked, false, 'nothing blocks now: ' + JSON.stringify(c.blockers));
    assert(c.passed.length >= 10, 'passed lists the cleared blockers: ' + c.passed);
    assert(c.passed_labels.length === c.passed.length && c.passed_labels.every((x) => x.text_ko) && c.passed_labels.some((x) => x.code === 'ng' && x.text_ko === 'NG 없음'), 'passed labels in Korean: ' + JSON.stringify(c.passed_labels));
    notes.push(`blockers each appeared and cleared: ${[...seen].sort().join(', ')}; documents check ${sizes.check} B`);

    // ════ ③ ⚔ 미리보기 뒤의 변경 · 지난 숫자 ════
    const localDay = (iso) => { const d = new Date(iso), q = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}`; };
    let pv = face().issuePreview();
    const ROLES = ['html', 'pdf', 'buckling-html', 'buckling-pdf', 'validation-html', 'validation-pdf', 'case-file', 'manifest'];
    assert(pv.label === 'R0' && pv.blockers.length === 0 && /^[0-9a-f]{32}$/.test(pv.nonce) && pv.files.length === 8 && JSON.stringify(pv.bundle.map((b) => b.role)) === JSON.stringify(ROLES),
      'preview R0 — the whole bundle: ' + JSON.stringify(pv.bundle));
    assert(pv.stamped_doc && pv.stamped_doc.meta.stamp.kind === 'issued' && pv.stamped_doc.meta.stamp.label === 'R0' && pv.stamp.date === localDay(new Date()),
      'the preview carries the stamped doc (local date): ' + JSON.stringify(pv.stamp));
    const rejects = async (promise, code, why) => { await assert.rejects(promise, (e) => e.code === code || (() => { throw new Error(`${why}: code ${e.code} (${e.message})`); })(), why); };
    await tool('work_items', { action: 'add', kind: 'report', title: '미리보기 뒤의 보고' });   // 근거(업무)가 바뀐다 → 초안이 낡는다
    await rejects(face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }), 'host.issue.changed', 'a change after the preview is refused');
    await tool('generate_report', {});
    DESK.RecordsDesk.ISSUE_NONCE_MS = 40;
    pv = face().issuePreview();
    await sleep(80);
    await rejects(face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }), 'host.issue.expired', 'an expired number is refused');
    DESK.RecordsDesk.ISSUE_NONCE_MS = 120000;
    // AI 는 발행하지 못한다
    const before = docsLog();
    const badTool = await raw('documents', { action: 'issue' });
    assert(badTool.isError, 'documents carrying issue is refused by the schema');
    for (const action of ['issue', 'person.issue', 'issuePreview', 'issue_preview', 'publish', 'release']) {
      const r = await post('/action', { action, fingerprint: pv.fingerprint, nonce: pv.nonce });
      assert(r.json && r.json.error, `direct POST '${action}' refused`);
    }
    const r2 = await post('/action', { action: 'documents', op: 'issue', fingerprint: pv.fingerprint, nonce: pv.nonce });
    assert(r2.json && r2.json.error && /no tool can issue/.test(r2.json.error), 'documents op issue refused: ' + JSON.stringify(r2.json));
    for (const kind of ['ai', 'screen']) {
      assert.throws(() => scope.runAs({ kind }, () => face().issuePreview()), /person-only/);
      assert.throws(() => scope.runAs({ kind }, () => face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce })), /person-only/);
    }
    for (const command of ['issue', 'issuePreview', 'publish']) { await p.__testDispatchMessage({ command, data: { fingerprint: pv.fingerprint, nonce: pv.nonce } }); }
    assert.strictEqual(docsLog(), before, 'no issue line from any of them');
    assert(!fs.existsSync(path.join(issueRoot, 'R0')), 'no issue folder');

    // ════ ② 발행 R0(진짜 인쇄) — 묶음 전부 ════
    const fileEvents = [];
    const offFile = p.onCaseFile((e) => fileEvents.push(e));
    // 여섯 탭 화면의 Save: 프로젝트의 대상이면 그 대상에(대화상자 없이) — 사건 'saved' 와 그 경로
    await p.__testDispatchMessage({ command: 'saveProject' });
    const caseAbs = p.caseFile().path;
    assert(caseAbs && /Beam\.csd$/.test(caseAbs) && fileEvents.some((e) => e.event === 'saved' && e.path === caseAbs && e.by === 'person'), 'Save in a project case saves the case: ' + JSON.stringify(fileEvents));
    pv = face().issuePreview();
    const csdBefore = fs.readFileSync(caseAbs);
    const iss = await face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce });
    const r0 = path.join(issueRoot, 'R0');
    const r0files = fs.readdirSync(r0).sort();
    const WANT = ['Beam.R0.csd', 'Beam.buckling.R0.html', 'Beam.buckling.R0.pdf', 'Beam.calc.R0.html', 'Beam.calc.R0.pdf', 'Beam.validation.R0.html', 'Beam.validation.R0.pdf', 'manifest.json'];
    assert.deepStrictEqual(r0files, WANT, 'R0 folder: ' + r0files);
    const man = JSON.parse(fs.readFileSync(path.join(r0, 'manifest.json'), 'utf8'));
    assert.strictEqual(man.files.length, 7, 'every file but the manifest is listed');
    for (const fl of man.files) { assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(pdir, ...fl.path.split('/')))).digest('hex'), fl.sha256, fl.path); }
    assert(/assumptions list and the review summary/.test(man.roles.pdf) && man.roles['case-file'] && man.files.every((x) => man.roles[x.role]), 'manifest roles: ' + JSON.stringify(man.roles));
    assert(fs.readFileSync(path.join(r0, 'Beam.R0.csd')).equals(csdBefore), 'the .csd copy is the saved bytes (not re-serialised)');
    assert(man.issuedDate === localDay(man.issuedAt), 'manifest issuedDate is the local date of issuedAt');
    for (const n of ['Beam.calc.R0.pdf', 'Beam.buckling.R0.pdf', 'Beam.validation.R0.pdf']) { assert.strictEqual(fs.readFileSync(path.join(r0, n)).slice(0, 5).toString(), '%PDF-', n + ' is a real PDF'); }
    const r0html = fs.readFileSync(path.join(r0, 'Beam.calc.R0.html'), 'utf8');
    assert(/발행 · R0 · 검토 /.test(r0html) && !/초안 · D-/.test(r0html) && r0html.includes('발행 · R0 · 검토 ') && r0html.includes(' · ' + localDay(man.issuedAt) + '<'), 'the HTML is the draft re-rendered with the issued stamp and the local date');
    for (const n of ['Beam.buckling.R0.html', 'Beam.validation.R0.html']) { assert(/발행 · R0 · 검토 /.test(fs.readFileSync(path.join(r0, n), 'utf8')), n + ' carries the same stamp'); }
    assert(/설계 검증표/.test(fs.readFileSync(path.join(r0, 'Beam.validation.R0.html'), 'utf8')), 'the validation table');
    await rejects(face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }), 'host.issue.used', 'a used number is refused');
    const lcs = (await tool('list_cases', {})).cases.find((x) => x.name === 'Beam');
    assert(lcs.last_issue && lcs.last_issue.label === 'R0' && lcs.last_issue.date === localDay(man.issuedAt) && lcs.last_issue.state === 'same', 'list_cases: last issue ' + JSON.stringify(lcs.last_issue));
    let dl = await tool('documents', { action: 'list' });
    sizes.list = dl.__bytes;
    assert(dl.issues.length === 1 && dl.issues[0].item === 'R0' && dl.issues[0].state === 'same' && dl.issues[0].date === localDay(man.issuedAt), 'documents list: R0 그대로 ' + JSON.stringify(dl.issues));
    const snap = Object.fromEntries(r0files.map((n) => [n, fs.readFileSync(path.join(r0, n))]));
    // 모델을 바꿔 저장 → R0 그대로(바이트)
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.065, r: 0.1 });
    await tool('save_case', {});
    for (const [n, b] of Object.entries(snap)) { assert(fs.readFileSync(path.join(r0, n)).equals(b), `R0/${n} byte-identical after a model change and save`); }
    // 손으로 고친 발행본 → 고쳐짐
    fs.appendFileSync(path.join(r0, 'Beam.calc.R0.html'), '<!-- edited -->');
    dl = await tool('documents', { action: 'list' });
    assert(dl.issues[0].state === 'edited' && dl.issues[0].state_ko === '고쳐짐', 'an edited issued copy reads 고쳐짐: ' + JSON.stringify(dl.issues[0]));
    notes.push(`issued R0: ${r0files.join(' · ')} (manifest hashes and roles, three real PDFs, the .csd = the saved bytes, the issued stamp with the local date on all three reports); byte-identical after a model change + save; edited by hand → 고쳐짐; documents list ${sizes.list} B`);

    // ════ ③ 반쯤 실패 → 실패한 발행, 차수를 두 번 쓰지 않는다 ════
    await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 });
    await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
    await tool('run_analysis', {});
    await flex({ Mu: 40, Vu: 1 });
    await tool('save_case', {});
    // 다시 돌린 뒤 사람이 다시 본다: 다시 확인 · 새 자동 가정(그 까닭을 적어 둔다)
    const again = (await tool('get_reviews', { type: 'check' })).items.filter((x) => x.state !== 'reviewed');
    notes.push(`after t 0.065 → 0.059 and a re-run: ${again.length ? again.map((x) => x.id + ' ' + (x.why || x.state)).join(', ') : 'every mark still valid (same bytes)'}`);
    if (again.length) { face().review({ mark: true, targets: again.map((x) => ({ type: 'check', key: x.key, shown: x.fp })) }); }
    for (const a of (await tool('assumptions', { action: 'list', include_others: true })).items.filter((x) => !x.closed && x.blocks_issue)) {
      if (a.status === 'provisional') { await tool('assumptions', { action: 'update', item: a.item, status: 'firm' }); }
      face().review({ mark: true, targets: [{ type: 'assumption', id: a.item, shown: p._desk.assumptionItems().find((x) => x.item === a.item).lastSeq }] });
    }
    await tool('generate_report', { format: 'html' });
    c = await blockers();
    assert(!c.blocked && c.warnings.some((w) => w.code === 'edited-previous-issue'), 'R1 is not blocked; the edited R0 is a warning: ' + JSON.stringify(c));
    pv = face().issuePreview();
    assert.strictEqual(pv.label, 'R1');
    S.__issueFault = (step) => { if (step === 'manifest') { const e = new Error('no space left on device'); e.code = 'ENOSPC'; throw e; } };
    await assert.rejects(face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce }), (e) => /failed issue/.test(e.message) && e.code === 'host.issue.failed', 'disk full halfway');
    S.__issueFault = null;
    const r1 = path.join(issueRoot, 'R1');
    assert(fs.existsSync(path.join(r1, 'Beam.calc.R1.html')) && !fs.existsSync(path.join(r1, 'manifest.json')), 'the half-made folder stays');
    dl = await tool('documents', { action: 'list' });
    assert(dl.issues.length === 1 && dl.failed && dl.failed[0].label === 'R1', 'a failed issue, not counted: ' + JSON.stringify([dl.issues.length, dl.failed]));
    pv = face().issuePreview();
    assert(pv.label === 'R1' && !pv.blockers.some((b) => b.code === 'unknown-issue-folder'), 'the next attempt is R1 again (the failed folder is known): ' + JSON.stringify(pv.blockers));
    const iss1 = await face().issue({ fingerprint: pv.fingerprint, nonce: pv.nonce });
    dl = await tool('documents', { action: 'list' });
    assert(iss1.item === 'R1' && dl.issues.map((x) => x.item).sort().join() === 'R0,R1' && fs.existsSync(`${r1}.failed-1`) && fs.existsSync(path.join(r1, 'manifest.json')),
      'R1 issued once; the failed folder moved aside to R1.failed-1');
    notes.push('disk full at the manifest: R1 left as a failed issue (not counted), the retry moved it to R1.failed-1 and issued R1 — the revision was not consumed twice');
    // 발행본의 .csd 사본은 읽기 전용(「발행본」)으로 열린다 — 기록에 아무것도 쓰지 않는다
    const logBefore = docsLog();
    const lo = p.__testLoadProjectFile(path.join(r0, 'Beam.R0.csd'));
    const ds = p._desk.status();
    assert(!lo.error && ds.file_read_only && ds.file_read_only.reason === 'issued-copy' && docsLog() === logBefore, 'the issued .csd opens read-only as an issued copy: ' + JSON.stringify(ds));
    assert(fileEvents.some((e) => e.event === 'opened' && /Beam\.R0\.csd$/.test(e.path)), 'the open is a structured event');
    offFile();
    notes.push('the issued .csd opens read-only (issued-copy), nothing recorded; Save in a project case saves the case; file opened / saved are events with the path (in-process only)');
    notes.push('⚔ the AI cannot issue: documents carrying issue (schema), 7 action names by direct POST with the real token, page messages, the face inside ai / screen — no issue line, no folder; a change after the preview, an expired number and a used number are refused');
    void iss;
  } finally {
    S.__issueFault = null;
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  for (const [k, v] of Object.entries({ check: 6, list: 8 })) { assert(!sizes[k] || sizes[k] <= v * 1024, `${k} ${sizes[k]} B ≤ ${v} KB`); }
  console.log(`records_issue_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('records_issue_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
