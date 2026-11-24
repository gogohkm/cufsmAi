/* global process, Buffer */
// R4-1 · R4-3 — 확인 표시와 대안(기록 설계 §2.4.8 · §2.4.9 · §3.5 · §5.5 · §5.7, 결정 D5 · D6 · D7 · D9 · D15 · D16) · 사본 정리.
// 진짜 패널 · 파이썬 · MCP 다리(포트 파일 + 토큰) · 진짜 MCP 서버(소스). 열쇠 · 프로젝트는 임시 폴더.
//  ① 확인: 화면이 보인 지문으로만(다르면 거절), 「확인 n/N」(get_case_status · list_cases · get_reviews), 다른 PC 처럼 끝자리만 다른 다시 돌림은
//     유효(1e-9), 계산된 값이 1e-5 다르면 「다시 확인 · 값이 다름」(다른 곳과 함께), 사본이 손상되면 「사본 손상」
//  ② D7: AI 가 firm 으로 적은 가정은 사람이 그 판에 확인해야 풀린다, 고치면 다시 확인. 답한 판단 요청도 같다. 믿기(person.trust)
//  ③ ⚔ 표시를 만드는 길이 없다: MCP 도구 이름 · 동작 이름 · 진짜 토큰의 직접 POST · 끼운 화면의 메시지 · MCP 문맥 안의 얼굴 — 모두 기록 그대로
//  ④ 대안: keep · compare · open(한 묶음, 결과는 다시 돌린다, 모르는 키는 버림) · drop, 사본 손상
//  ⑤ 사본 정리: 확인 · 대안이 가리키는 사본은 남는다. ⑥ 엔진 자체 가정은 다음 실행에 나오지 않으면 프로그램이 닫는다
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
const notes = [];

async function main() {
  const ctx = await createPanel();
  if (!ctx) { console.log('records_review_contract: SKIP — no .venv python'); return; }
  const p = ctx.panel;
  const S = ctx.StcfsdPanel;
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd_r4_'));
  const root = path.join(box, 'roots'); fs.mkdirSync(root);
  const keyA = path.join(box, 'keyA'), keyB = path.join(box, 'keyB');
  const saveKey = S.writerKeyDir; const saveRoots = S.projectRoots;
  S.writerKeyDir = keyA; S.projectRoots = [root];
  const scope = ctx.load(path.join('src', 'mcp', 'actorScope.ts'));
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
  const client = new Client({ name: 'r4-test', version: '1.0' });
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
  const post = (urlPath, body, headers = {}) => new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: bridge.port, path: urlPath, method: 'POST', headers: {
      Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers } }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, error: String(e.message) }));
    req.write(payload); req.end();
  });
  const face = () => p.recordsPerson;
  const sizes = {};
  try {
    await tool('open_project', { name: 'R4', create: true });
    await tool('new_case', { name: 'Beam', kind: 'section-only' });
    await tool('open_case', { name: 'Beam' });
    const pdir = fs.realpathSync.native(path.join(root, 'R4'));
    const reviewsDir = path.join(pdir, '.stcfsd', 'log', 'reviews');
    const reviewBytes = () => { try { return fs.readdirSync(reviewsDir).map((n) => fs.readFileSync(path.join(reviewsDir, n), 'utf8')).join('|'); } catch { return ''; } };
    const design = async (t = 0.059) => {
      await tool('set_section_template', { type: 'lippedc', H: 8, B: 2.5, D: 0.625, t, r: 0.1 });
      await tool('set_load_case', { load_case: 'bending_xx_pos', fy: 50 });
      await tool('run_analysis', {});
      return tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu: 40, Vu: 1 });
    };
    await design();

    // ════ ① 확인 표시 ════
    let gr = await tool('get_reviews', {});
    sizes.get_reviews = gr.__bytes;
    const checks = gr.items.filter((x) => x.type === 'check');
    assert(gr.total >= 5 && gr.reviewed === 0 && checks.every((x) => x.state === 'unreviewed' && /^sha256:/.test(x.fp)) && /not an electronic signature/.test(gr.meaning),
      'get_reviews: N checks, none reviewed, the meaning stated: ' + JSON.stringify(gr).slice(0, 300));
    assert(/전자서명이 아닙니다/.test(gr.meaning_ko) && /^sha256:/.test(gr.group_fps.section) && /^sha256:/.test(gr.group_fps.material_model) && Object.keys(gr.group_fps).length >= 5,
      'get_reviews: Korean meaning and the input-group fingerprints: ' + JSON.stringify(gr.group_fps));
    const c0 = checks[0], c1 = checks[1];
    assert.throws(() => face().review({ mark: true, targets: [{ type: 'check', key: c0.key, shown: 'sha256:' + '0'.repeat(64) }] }),
      (e) => /another version/.test(e.message) && e.code === 'host.review.shown_differs', 'a different shown fingerprint is refused, with a code');
    face().review({ mark: true, targets: [{ type: 'group', group: 'section', shown: gr.group_fps.section }] });
    assert((await tool('get_reviews', { type: 'group' })).items.some((x) => x.group === 'section' && x.state === 'reviewed'), 'the group mark from group_fps');
    face().review({ mark: false, targets: [{ type: 'group', group: 'section', shown: gr.group_fps.section }] });
    const m1 = face().review({ mark: true, targets: [{ type: 'check', key: c0.key, shown: c0.fp }, { type: 'check', key: c1.key, shown: c1.fp }] });
    assert.strictEqual(m1.targets, 2);
    gr = await tool('get_reviews', {});
    let st = await tool('get_case_status', {});
    assert(gr.reviewed === 2 && st.reviews.reviewed === 2 && st.reviews.total === gr.total, 'reviewed 2 / N: ' + JSON.stringify(st.reviews));
    const lc = (await tool('list_cases', {})).cases.find((c) => c.name === 'Beam');
    assert(lc.reviews && lc.reviews.reviewed === 2 && lc.reviews.basis === 'current', 'list_cases n/N: ' + JSON.stringify(lc.reviews));
    // 같은 결과를 다시 돌린다 — 같은 PC 는 같은 바이트(지문이 같다)
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu: 40, Vu: 1 });
    gr = await tool('get_reviews', {});
    assert(gr.items.find((x) => x.key === c0.key).how === 'same-fingerprint', 'same PC, same bytes');
    // 다른 PC 처럼: 계산된 값의 끝자리만(1e-9) — 유효(같은 내용). 계산된 값이 1e-5 — 다시 확인
    const shake = (rel, pick) => {
      const d = p._lastDesignResult;
      const it = d.design_checks.find((x) => x.id === pick.id && JSON.stringify(x.location ?? null) === JSON.stringify(pick.location ?? null));
      if (typeof it.ratio === 'number') { it.ratio *= 1 + rel; }
      if (it.capacity && typeof it.capacity.value === 'number') { it.capacity.value *= 1 + rel; }
    };
    shake(1e-9, c0);
    gr = await tool('get_reviews', {});
    let r0 = gr.items.find((x) => x.key === c0.key);
    assert(r0.state === 'reviewed' && r0.how === 'same-content', 'a 1e-9 difference keeps the mark: ' + JSON.stringify(r0));
    shake(1e-5, c0);
    gr = await tool('get_reviews', {});
    r0 = gr.items.find((x) => x.key === c0.key);
    assert(r0.state === 'review-again' && r0.why === 'different-values' && r0.differences.length >= 1, 'a 1e-5 difference on a computed (non-global) value: review again ' + JSON.stringify(r0));
    st = await tool('get_case_status', {});
    assert(st.reviews.reviewed === 1 && st.reviews.review_again === 1, 'counts follow: ' + JSON.stringify(st.reviews));
    // 사본 손상 — 그 실행의 사본 파일을 바꾼다
    const blobDir = path.join(pdir, '.stcfsd', 'blobs');
    const allBlobs = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) { walk(q); } else { allBlobs.push(q); } } }; walk(blobDir);
    const markLine = fs.readdirSync(reviewsDir).map((n) => fs.readFileSync(path.join(reviewsDir, n), 'utf8')).join('\n').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.event === 'mark' && l.targets[0].resultBlob);
    const sha = markLine.targets[0].resultBlob;
    const bf = allBlobs.find((q) => path.basename(q).startsWith(sha) || q.includes(sha));
    const keep = fs.readFileSync(bf);
    fs.writeFileSync(bf, Buffer.from('not gzip'));
    gr = await tool('get_reviews', {});
    assert.strictEqual(gr.items.find((x) => x.key === c0.key).why, 'copy-damaged', 'a copy with a wrong hash: copy damaged');
    fs.writeFileSync(bf, keep);
    notes.push(`marks: shown fingerprint required, reviewed 2/${gr.total} in get_case_status · list_cases · get_reviews; same bytes → same-fingerprint, 1e-9 → same-content, 1e-5 → review again (different values), damaged copy → copy damaged; get_reviews ${sizes.get_reviews} B`);

    // ════ ② D7 — 가정 · 답한 판단 요청 · 믿기 ════
    const a = await tool('assumptions', { action: 'add', text: '데크 체결 간격 300 mm', status: 'firm', basis: '도면' });
    let ag = (await tool('assumptions', { action: 'get', item: a.item })).item;
    assert(ag.person_confirmed === false && ag.blocks_issue === true, 'firm by the AI still blocks');
    assert.strictEqual(ag.seq, p._desk.assumptionItems().find((x) => x.item === a.item).lastSeq, 'the reply carries the version (seq) the screen confirms');
    const aSeq = (await tool('get_reviews', { type: 'assumption' })).items.length;  // 아직 표시 없음
    void aSeq;
    const asmItem = p._desk.assumptionItems().find((x) => x.item === a.item);
    face().review({ mark: true, targets: [{ type: 'assumption', id: a.item, shown: ag.seq }] });   // 답의 seq 로(화면이 하는 대로)
    void asmItem;
    ag = (await tool('assumptions', { action: 'get', item: a.item })).item;
    assert(ag.person_confirmed === true && ag.blocks_issue === false, 'confirmed by the person on that version: ' + JSON.stringify(ag));
    await tool('assumptions', { action: 'update', item: a.item, text: '데크 체결 간격 300 mm (S-101)' });
    ag = (await tool('assumptions', { action: 'get', item: a.item })).item;
    assert(ag.person_confirmed === false && ag.blocks_issue === true, 'a new version needs a new confirmation');
    const q = await tool('work_items', { action: 'add', kind: 'question', title: '랩 길이', options: [{ label: '600' }, { label: '900' }] });
    const qSeq = async () => (await tool('work_items', { action: 'get', item: q.item })).item.seq;
    assert.throws(() => face().review({ mark: true, targets: [{ type: 'work', id: q.item, shown: 1 }] }), (e) => /no answer yet/.test(e.message) && e.code === 'host.review.no_answer');
    await tool('work_items', { action: 'answer', item: q.item, said: '600 으로', chosen: 0 });
    const qs = await qSeq();
    assert(Number.isInteger(qs) && (await tool('work_items', { action: 'list' })).items.find((x) => x.item === q.item).seq === qs, 'work_items list · get carry seq');
    face().review({ mark: true, targets: [{ type: 'work', id: q.item, shown: qs }] });
    assert((await tool('get_reviews', { type: 'work' })).items.some((x) => x.item === q.item && x.seq === qs && x.last_seq === qs), 'get_reviews: seq and last_seq');
    const qg = (await tool('work_items', { action: 'list' })).items.find((x) => x.item === q.item);
    assert(qg.person_confirmed === true && qg.blocks_issue === false, 'answered question confirmed by the person: ' + JSON.stringify(qg));
    // 믿기 — 다른 작성자(B)의 업무 항목이 믿은 뒤에 센다
    S.writerKeyDir = keyB;
    await tool('open_project', { name: 'R4' });
    await tool('work_items', { action: 'add', kind: 'report', title: 'B 의 보고', scope: 'project' });
    S.writerKeyDir = keyA;
    await tool('open_project', { name: 'R4' });
    await tool('open_case', { name: 'Beam' });
    assert(!(await tool('work_items', { action: 'list', include_others: true })).items.some((x) => x.title === 'B 의 보고'), 'B is not trusted yet');
    const W = ctx.load(path.join('src', 'records', 'writer.ts'));
    const wB = W.loadOrCreateWriter(keyB);
    assert.throws(() => face().trust('w' + 'a'.repeat(20), true), /no card/);
    assert((await tool('get_reviews', {})).writers.some((x) => x.writer_id === wB.writerId && x.trusted === false), 'get_reviews.writers carries the writer id for person.trust');
    const tr = face().trust(wB.writerId, true);
    assert(tr.trusted === true, 'person.trust');
    assert((await tool('work_items', { action: 'list', include_others: true })).items.some((x) => x.title === 'B 의 보고'), 'after trusting, B\'s lines count');
    notes.push('D7: an assumption the AI set to firm blocks until the person confirms that version (a new version needs a new mark); answered questions the same; person.trust makes another writer\'s lines count');

    // ════ ③ ⚔ 표시를 만드는 길이 없다 ════
    const before = reviewBytes();
    const names = (await client.listTools()).tools.map((x) => x.name);
    // 82 = 79 + 통일안 6.6 의 공통 이름 셋(work_status · work_log · show — 읽기 · 가리키기만)
    assert(names.length === 82 && names.includes('get_reviews') && !names.some((n) => /^(mark|review|set_review|person|trust|confirm)/.test(n)), 'no tool marks: ' + names.filter((n) => /review|mark|trust|confirm/.test(n)));
    for (const action of ['review', 'mark', 'unmark', 'person.review', 'reviews', 'set_review', 'mark_review', 'confirm', 'confirm_assumption', 'trust', 'person.trust', 'recordsPerson']) {
      const r = await post('/action', { action, mark: true, targets: [{ type: 'check', key: c1.key, shown: c1.fp }], writerId: wB.writerId, trust: true });
      assert(r.json && r.json.error, `direct POST action '${action}': refused ` + JSON.stringify(r.json).slice(0, 160));
    }
    for (const command of ['review', 'personReview', 'reviewMark', 'trust']) {
      await p.__testDispatchMessage({ command, data: { mark: true, targets: [{ type: 'check', key: c1.key, shown: c1.fp }] } });
    }
    for (const kind of ['ai', 'screen']) {
      assert.throws(() => scope.runAs({ kind }, () => face().review({ mark: true, targets: [{ type: 'check', key: c1.key, shown: c1.fp }] })), /person-only/, `${kind}: person.review throws`);
      assert.throws(() => scope.runAs({ kind }, () => face().trust(wB.writerId, false)), /person-only/, `${kind}: person.trust throws`);
    }
    assert.strictEqual(reviewBytes(), before, 'no mark written by any of them');
    const src = fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'recordTools.ts'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src', 'mcp', 'server.ts'), 'utf8');
    assert(!/person\.(review|trust)|\.review\(|recordsPerson/.test(src.replace(/\/\/.*$/gm, '')), 'no MCP source names the person face');
    notes.push('⚔ no way to mark: 82 tools without one, 12 action names by direct POST with the real token, 4 page messages, the face inside ai / screen contexts — the review records unchanged');

    // ════ ④ 대안 ════
    await design();   // ① 에서 흔든 결과 대신 기록된 실행
    const k1 = await tool('alternatives', { action: 'keep', label: 't 0.059' });
    await design(0.065);
    const k2 = await tool('alternatives', { action: 'keep', label: 't 0.065' });
    const al = await tool('alternatives', { action: 'list' });
    sizes.alternatives_list = al.__bytes;
    assert(al.items.length === 2 && al.items.find((x) => x.item === k2.item).is_now === true && al.items.find((x) => x.item === k1.item).differs_from_now.fields >= 1,
      'list: is_now, differs from now: ' + JSON.stringify(al.items));
    const cmp = await tool('alternatives', { action: 'compare', item: k1.item });
    sizes.alternatives_compare = cmp.__bytes;
    assert(cmp.rows.length >= 3 && cmp.rows.every((r) => r.now && r.alt) && cmp.head.now.checks === cmp.head.alt.checks && cmp.rows.some((r) => r.now.ratio !== r.alt.ratio),
      'compare by check key: ' + JSON.stringify(cmp).slice(0, 400));
    const lcBefore = (await tool('list_changes', { limit: 100 })).total;
    const op = await tool('alternatives', { action: 'open', item: k1.item });
    const lcAfter = await tool('list_changes', { limit: 3 });
    assert(op.ok && op.model.includes('sectionParams') && lcAfter.total === lcBefore + 1 && lcAfter.changes[0].trigger === 'alternatives', 'open: one change bundle ' + JSON.stringify([op, lcAfter.changes[0]]));
    assert(Math.abs(p._model.sectionParams.t - 0.059) < 1e-12 && !p._lastDesignResult, 'the alternative\'s model is back and the design result is not restored from the copy');
    // 모르는 키를 들이지 않는다(V5b-01) — 꾸민 사본
    const evilSnap = p._desk.putCopy({ model: { sectionParams: p._model.sectionParams, __evil: 1, pythonPath: 'C:\\x.exe' }, case: { inputs: { Cb: 1.2, injected_key: 5 }, spans: null, mcpOnly: {} } });
    const caseId = p._desk.status().case.caseId;
    await scope.runAs({ kind: 'ai', request: 'r-1', tool: 'alternatives' }, async () => p._desk.writeAlternative('keep', { caseId, label: 'crafted', contentFp: 'sha256:' + '1'.repeat(64), snapshot: evilSnap, runs: {} }));
    const crafted = (await tool('alternatives', { action: 'list' })).items.find((x) => x.label === 'crafted');
    const op2 = await tool('alternatives', { action: 'open', item: crafted.item });
    assert(op2.ignored_keys.includes('model.__evil') && op2.ignored_keys.includes('model.pythonPath') && op2.ignored_keys.includes('case.inputs.injected_key') && !('pythonPath' in p._model) && !('injected_key' in p._caseKeeper.state.inputs),
      'unknown keys are dropped: ' + JSON.stringify(op2));
    await tool('alternatives', { action: 'drop', item: crafted.item });
    assert(!(await tool('alternatives', { action: 'list' })).items.some((x) => x.item === crafted.item), 'hidden');
    // 사본 손상 — 스냅숏 파일
    const k2s = p._desk.alternativeItems().find((x) => x.item === k2.item).snapshot;
    const allB = []; walk.call(null, blobDir); void allB;
    const files = []; const walk2 = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const qq = path.join(d, e.name); if (e.isDirectory()) { walk2(qq); } else { files.push(qq); } } }; walk2(blobDir);
    const sf = files.find((qq) => qq.includes(k2s));
    fs.writeFileSync(sf, Buffer.from('x'));
    const bad = await raw('alternatives', { action: 'open', item: k2.item });
    assert(bad.data && /damaged|missing/.test(bad.data.error || ''), 'a damaged snapshot copy is not opened: ' + bad.text.slice(0, 200));
    // ════ ④-2 is_now = 지금 상태와 지킨 스냅숏만 — 화면의 거울 메아리(끝자리)가 keep 앞이든 뒤든 같은 답 · A · 사람의 대안 ════
    await design(0.065);
    const FP = ctx.load(path.join('src', 'records', 'fp.ts'));
    const echo = async () => {   // 화면이 지금 단위로 적고 다시 읽은 값(끝자리만 다름) — origin mirror
      const fy = p.__testGetCase().state.inputs.fy;
      await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'mirror', changes: { fy: fy * (1 + 3e-13) } } });
    };
    let flips = 0;
    const same = [];
    for (let i = 0; i < 20; i += 1) {
      if (i % 2 === 0) { await echo(); }
      const kk = await tool('alternatives', { action: 'keep', label: `same ${i}` });
      same.push(kk.item);
      if (i % 2 === 1) { await echo(); }
      const kept = p._desk.alternativeItems().find((x) => x.item === kk.item);
      if (kept.contentFp !== FP.contentFp(p._model, p.__testGetCase().state).contentFp) { flips += 1; }
      const cm = await tool('alternatives', { action: 'compare', item: kk.item });
      assert(cm.is_now === true && typeof cm.head.alt.A === 'number' && cm.head.alt.A > 0 && Math.abs(cm.head.alt.A - cm.head.now.A) < 1e-12 * cm.head.now.A,
        `round ${i}: compare is_now and A: ${JSON.stringify({ is_now: cm.is_now, head: cm.head })}`);
      const nowItems = (await tool('alternatives', { action: 'list' })).items.filter((x) => x.is_now).map((x) => x.item);
      assert(same.every((x) => nowItems.includes(x)) && !nowItems.includes(k1.item), `round ${i}: list is_now ${JSON.stringify(nowItems)}`);
    }
    assert(flips >= 5, `the echo after keep moved the content fingerprint in ${flips} rounds (the old rule would have said 「not now」 there)`);
    const l0 = (await tool('alternatives', { action: 'list' })).items;
    const a1 = l0.find((x) => x.item === k1.item);
    assert(typeof a1.A === 'number' && a1.A < l0.find((x) => x.item === same[0]).A && a1.A_unit === 'in²', 'A from the snapshot section (t 0.059 < t 0.065): ' + JSON.stringify(a1));
    // 사람의 대안 — 지금 상태를 대안으로 두기 · 이름 · 숨기기 · 되살리기(행위자 person), MCP · 화면 문맥 안에서는 던진다
    const pk = face().alternative({ op: 'keep', label: '사람이 둔 안' });
    let li = (await tool('alternatives', { action: 'list' })).items.find((x) => x.item === pk.item);
    assert(li && li.written_by === 'person' && li.is_now === true && p._desk.alternativeItems().find((x) => x.item === pk.item).by === 'person', 'person keep: ' + JSON.stringify(li));
    face().alternative({ op: 'rename', item: pk.item, label: '사람 안 2' });
    face().alternative({ op: 'drop', item: pk.item });
    assert(!(await tool('alternatives', { action: 'list' })).items.some((x) => x.item === pk.item), 'person drop hides it');
    face().alternative({ op: 'undrop', item: pk.item });
    li = (await tool('alternatives', { action: 'list' })).items.find((x) => x.item === pk.item);
    assert(li && li.label === '사람 안 2' && !li.hidden, 'person rename · undrop: ' + JSON.stringify(li));
    for (const kind of ['ai', 'screen']) {
      assert.throws(() => scope.runAs({ kind }, () => face().alternative({ op: 'keep', label: 'x' })), /person-only/, `${kind}: person.alternative throws`);
    }
    // 정말 다른 값(Fy 1 %)이면 어느 것도 지금이 아니다
    await p.__testDispatchMessage({ command: 'caseEdit', data: { origin: 'user', changes: { fy: 50.5 } } });
    assert(!(await tool('alternatives', { action: 'list' })).items.some((x) => x.is_now), 'a real change: none is now');
    notes.push(`is_now from the kept snapshot and the current state only: 20 × keep → compare with a mirror echo before / after keep (fingerprint moved in ${flips}) — always now, A in list and compare; person keep · rename · drop · undrop (actor person), refused inside ai / screen`);
    notes.push(`alternatives: keep · list (is_now, differs) · compare by check key · open = one change bundle, results re-run, unknown keys dropped · drop · damaged copy refused; list ${sizes.alternatives_list} B, compare ${sizes.alternatives_compare} B`);

    // ════ ⑤ 사본 정리: 확인 · 대안이 가리키는 사본은 남는다 ════
    await design();
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 61, Cb: 1, Mu: 40, Vu: 1 });
    await tool('aisi_design_flexure', { design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 62, Cb: 1, Mu: 40, Vu: 1 });
    const runsBefore = p._desk.runsOf().filter((r) => r.kind === 'member_design');
    const removed = p._desk.pruneCopies(1);
    const has = (b) => b && p._desk.blob(b).ok;
    const k1Alt = p._desk.alternativeItems().find((x) => x.item === k1.item);
    assert(removed >= 1 && has(sha) && has(k1Alt.runs.member_design.blob) && has(runsBefore[runsBefore.length - 1].blob),
      `pruning kept the marked run copy, the alternative copy and the newest (${removed} removed)`);
    const unref = runsBefore.slice(0, -1).map((r) => r.blob).filter((b) => b && b !== sha && b !== k1Alt.runs.member_design.blob && !p._desk.alternativeItems().some((x) => Object.values(x.runs).some((y) => y.blob === b)));
    assert(unref.length && unref.some((b) => !has(b)), 'an unreferenced older copy is removed');
    notes.push(`pruning: newest per case and kind + every copy a mark or an alternative refers to (${removed} removed with keep 1)`);

    // ════ ⑥ 엔진 자체 가정 — 다음 실행에 나오지 않으면 프로그램이 닫는다 ════
    await tool('set_section_template', { type: 'lippedz', H: 8, B: 2.25, D: 0.91, t: 0.059, r: 0.1875 });
    await tool('new_case', { name: 'Purlin', kind: 'roof-purlin' });
    await tool('open_case', { name: 'Purlin' });
    await tool('run_case_check', { what: 'loads' });
    let eng = (await tool('assumptions', { action: 'list' })).items.filter((x) => x.origin === 'program-engine');
    const ix = eng.find((x) => /Ix 하나/.test(x.text));
    assert(ix, 'the engine\'s one-Ix assumption is there: ' + JSON.stringify(eng.map((x) => x.text.slice(0, 30))));
    const n = p._caseKeeper.state.spans.spans.length;   // 경간 표의 수
    await tool('set_case_inputs', { inputs: { spanIxIn4: Array.from({ length: n }, () => 10.5) } });
    await tool('run_case_check', { what: 'loads' });
    const all = (await tool('assumptions', { action: 'list', include_closed: true })).items;
    const ixNow = all.find((x) => x.item === ix.item);
    assert(ixNow.closed === true && ixNow.blocks_issue === false, 'the program closed the engine assumption that no longer fires: ' + JSON.stringify(ixNow));
    notes.push('engine assumption closed by the program when the next run no longer produces it (one Ix → I per span)');
  } finally {
    try { await client.close(); } catch { /* */ }
    try { bridge.stop(); } catch { /* */ }
    ctx.close();
    S.writerKeyDir = saveKey; S.projectRoots = saveRoots;
    try { fs.rmSync(box, { recursive: true, force: true }); } catch { /* */ }
  }
  for (const [k, v] of Object.entries({ get_reviews: 12, alternatives_list: 8, alternatives_compare: 12 })) { assert(!sizes[k] || sizes[k] <= v * 1024, `${k} ${sizes[k]} B ≤ ${v} KB`); }
  console.log(`records_review_contract: PASS (${notes.join('; ')})`);
}
main().catch((e) => { console.error('records_review_contract: FAIL', e && e.stack ? e.stack : e); process.exitCode = 1; });
