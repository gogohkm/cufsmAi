/* global process, Buffer */
// K3 — 호스트가 만드는 검증 · 보고서(화면 없이). 진짜 호스트(StcfsdPanel) + 진짜 파이썬, 화면 없음. PDF 는 시스템 Edge headless(보이지 않음).
//  1. validate_design: 화면과 같은 모듈의 항목 — id 가 모두 있고, 요약에 통과가 아닌 항목 · 통과 항목의 주석이 다 있다(요약 규칙), full = 모든 항목
//  2. generate_report: 파일 규율 — 쓰는 자리(열린 .csd 의 폴더 · 없으면 임시 폴더), 이름 다듬기, 표지가 있는 우리 파일만 덮기,
//     남의 파일 · 링크는 건드리지 않음, AI 가 준 경로 인자는 무시
//  3. 좌굴 보고서를 화면 없이: 서명곡선 SVG 와 「화면 없이 만든 보고서」 글
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPanel, loadTs, makeFakeVscode } = require('./panel_harness');

async function main() {
  const RF = loadTs('src/case/reportFiles.ts', makeFakeVscode());
  const PP = loadTs('src/case/pdfPrint.ts', makeFakeVscode());
  // ── 이름 다듬기(검토 대상 이름이 경로를 만들지 못한다) ─────────────────────────
  const cases = [['beam-1', 'beam-1'], ['../../evil', '_.._evil'], ['C:\\Windows\\x', 'C__Windows_x'], ['.hidden', 'hidden'], ['CON', '_CON'],
    ['nul.report', '_nul.report'], ['a\u202ebc', 'abc'], ['tab\there', 'tab_here'], ['trailing. ', 'trailing'], ['', 'stcfsd'], ['x'.repeat(90), 'x'.repeat(60)]];
  for (const [raw, want] of cases) { assert.strictEqual(RF.safeBaseName(raw), want, `safeBaseName(${JSON.stringify(raw)})`); }
  for (const [raw] of cases) { const n = RF.safeBaseName(raw); assert(!/[\\/:]/.test(n) && !n.startsWith('.'), `no separators / leading dot: ${n}`); }

  const ctx = await createPanel();
  if (!ctx) { console.log('k3_host_review: SKIP — no .venv python (name rules checked)'); return; }
  const p = ctx.panel;
  const base = path.join(__dirname, '..', 'rendered', 'out', 'k3');
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'host-'));
  const results = [];
  try {
    await p.handleMcpAction({ action: 'generate_template', section_type: 'lippedc', params: { H: 8, B: 2.5, D: 0.625, t: 0.059, r: 0.1 } });
    await p.handleMcpAction({ action: 'set_load_case', load_case: 'bending_xx_pos', fy: 50 });
    await p.handleMcpAction({ action: 'run_analysis' });
    const d = await p.handleMcpAction({ action: 'aisi_design', member_type: 'flexure', design_method: 'LRFD', Fy: 50, Fu: 65, Lb: 60, Cb: 1, Mu: 40, Vu: 1 });
    assert(!d.error, d.error);

    // ── 1. validate_design ──────────────────────────────────────────────
    const sum = await p.handleMcpAction({ action: 'validate_design' });
    const full = await p.handleMcpAction({ action: 'validate_design', detail: 'full' });
    const si = await p.handleMcpAction({ action: 'validate_design', report_units: 'SI', detail: 'full' });
    assert(full.items.length >= 30 && full.counts.total === full.items.length, `full lists every item (${full.items.length})`);
    assert(full.items.every((i) => typeof i.id === 'string' && i.id.startsWith('val.')), `every item has a val.* id: ${full.items.filter((i) => !i.id).map((i) => i.item).join(', ')}`);
    const notPass = full.items.filter((i) => i.status !== 'pass');
    assert.deepStrictEqual(sum.items.map((i) => i.id), notPass.map((i) => i.id), 'the summary has every item that is not pass');
    const passNotes = [...new Set(full.items.filter((i) => i.status === 'pass' && i.note).map((i) => i.note))];
    assert.deepStrictEqual(sum.pass_notes || [], passNotes, 'the summary has every distinct note of the passing items');
    assert(si.units === 'SI' && si.items.some((i) => / mm\b| MPa\b/.test(i.value + i.criterion)), 'SI values in SI');
    const kb = (o) => Buffer.byteLength(JSON.stringify(o));
    assert(kb(sum) <= 12 * 1024, `validate_design summary ${kb(sum)} B ≤ 12 KB`);
    results.push(`validate_design ${full.items.length} items, summary ${kb(sum)} B, full ${kb(full)} B`);

    // ── 2. generate_report: 열린 파일 없음 → 임시 폴더 ─────────────────────────
    const r1 = await p.handleMcpAction({ action: 'generate_report', filepath: path.join(dir, 'steer.html'), dir: 'C:\\Windows', path: '..\\..' });
    assert(!r1.error, r1.error);
    const tmpDir = fs.realpathSync.native(path.join(os.tmpdir(), 'stcfsd-reports'));
    assert.strictEqual(r1.folder, 'temp');
    assert.strictEqual(path.dirname(r1.files.html), tmpDir, 'no .csd open: the temporary report folder — the AI\'s path arguments are ignored');
    assert(!fs.existsSync(path.join(dir, 'steer.html')), 'nothing written where the AI pointed');
    assert(fs.readFileSync(r1.files.html, 'utf8').startsWith(RF.HTML_MARKER), 'HTML carries the program marker');
    // V7-02: 인쇄의 허용 목록(CSP 와 따로 서는 막음)은 진짜 보고서를 한 글자도 바꾸지 않는다 — 보고서는 이스케이프한 글과 그리기의 태그뿐
    { const page = fs.readFileSync(r1.files.html, 'utf8').slice(RF.HTML_MARKER.length + 1); assert.strictEqual(PP.sanitizeForPrint(page), page, 'the print allow-list keeps the real report unchanged'); }
    assert(r1.files.pdf && fs.readFileSync(r1.files.pdf).toString('latin1').includes(RF.PDF_MARKER.trim()), 'PDF written with the marker');
    assert(r1.pages >= 3 && r1.sections.includes('StCFSD — 냉간성형강 설계 보고서') && r1.sections.some((x) => /설계 계산/.test(x)), `pages ${r1.pages}, sections ${r1.sections.slice(0, 3)}`);
    assert(kb(r1) <= 12 * 1024, `generate_report summary ${kb(r1)} B ≤ 12 KB`);
    results.push(`generate_report ${r1.pages} pages, summary ${kb(r1)} B`);

    // ── 열린 .csd 의 폴더 · 이름 · 덮어쓰기 규칙 ────────────────────────────
    const csd = path.join(dir, '.보 검토  1.csd');
    await p.__testWriteProjectFile(csd);
    const r2 = await p.handleMcpAction({ action: 'generate_report', format: 'html' });
    assert.strictEqual(r2.folder, 'case_folder');
    assert.strictEqual(path.dirname(r2.files.html), fs.realpathSync.native(dir), 'next to the open .csd');
    const name = path.basename(r2.files.html);
    assert(/^보 검토 1\.report\.r\d+\.html$/.test(name), `name from the case, sanitised (${name})`);
    const own = fs.readFileSync(r2.files.html, 'utf8');
    const r3 = await p.handleMcpAction({ action: 'generate_report', format: 'html' });
    assert.strictEqual(r3.files.html, r2.files.html, 'our own report (marker) is overwritten in place');
    // 남의 파일: 같은 이름, 표지 없음 → 덮지 않고 다음 번호
    fs.writeFileSync(r2.files.html, '<p>person\'s own file</p>');
    const r4 = await p.handleMcpAction({ action: 'generate_report', format: 'html' });
    assert.strictEqual(fs.readFileSync(r2.files.html, 'utf8'), '<p>person\'s own file</p>', 'a foreign file is never overwritten');
    assert(/-2\.html$/.test(r4.files.html), `a numbered name instead (${path.basename(r4.files.html)})`);
    void own;
    // 링크: 같은 이름이 심볼릭 링크면 따라가지 않는다(권한이 없으면 이 PC 에서는 건너뛴다)
    const outside = path.join(dir, 'outside-target.html');
    fs.writeFileSync(outside, 'outside');
    const stem = path.basename(r2.files.html, '.html');
    const linkPath = path.join(dir, stem + '-3.html');
    let linked = false;
    try { fs.symlinkSync(outside, linkPath, 'file'); linked = true; } catch (e) {
      // 파일 링크를 만들 권한이 없으면(개발자 모드 아님) 폴더 접합점(junction — 권한 없이 된다)을 그 이름에
      const outDir = path.join(dir, 'outside-dir');
      fs.mkdirSync(outDir, { recursive: true });
      fs.symlinkSync(outDir, linkPath, 'junction');
      linked = true;
      results.push(`file symlink not allowed (${e.code}) — tested with a junction`);
    }
    if (linked) {
      fs.writeFileSync(r4.files.html, '<p>foreign 2</p>');   // -2 도 남의 것이 되게 → 다음은 -3(링크) → -4
      const r5 = await p.handleMcpAction({ action: 'generate_report', format: 'html' });
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside', 'the link target is untouched');
      assert(/-4\.html$/.test(r5.files.html), `the link name is skipped (${path.basename(r5.files.html)})`);
    }

    // ── 기록 갈래의 자리(호스트 안에서만): 폴더 · 도장 · 덧붙일 절 ──────────────────
    const proj = path.join(dir, '03_계산서');
    fs.mkdirSync(proj, { recursive: true });
    const rr = await p.generateReportFiles({ format: 'html' }, { folder: proj, stamp: { kind: 'draft', label: 'R1', notChecked: true },
      appendSections: [{ title: '가정', blocks: [{ kind: 'para', text: 'assumption A' }] }, { title: '<b>옛 꼴</b>', html: '<img src=x onerror=alert(1)>' }] });
    assert.strictEqual(path.dirname(rr.files.html), fs.realpathSync.native(proj), 'an internal caller decides the folder');
    const rh = fs.readFileSync(rr.files.html, 'utf8');
    assert(/report-stamp-draft[\s\S]*초안 · R1 · 확인 안 함/.test(rh) && /<h2>\d+\. 가정<\/h2><p>assumption A<\/p>/.test(rh), 'stamp on top, appended section (ReportDoc blocks)');
    // K3-7 · V7-02: 덧붙일 절도 글로만 — 옛 {title, html} 의 HTML 은 글 그대로(이스케이프)
    assert(/&lt;b&gt;옛 꼴&lt;\/b&gt;<\/h2><p>&lt;img src=x onerror=alert\(1\)&gt;<\/p>/.test(rh) && !/<img src=x/.test(rh), 'appended HTML is escaped text');
    assert(/Content-Security-Policy[^>]*default-src 'none'/.test(rh), 'the written HTML carries the CSP');
    const jn = path.join(dir, 'linked-folder');
    fs.symlinkSync(proj, jn, 'junction');
    await assert.rejects(() => p.generateReportFiles({ format: 'html' }, { folder: jn }), /not a plain folder/, 'a linked folder is refused');
    const viaMcp = await p.handleMcpAction({ action: 'generate_report', format: 'html', folder: proj, stamp: { kind: 'issued' } });
    assert(path.dirname(viaMcp.files.html) !== fs.realpathSync.native(proj) && !/report-stamp/.test(fs.readFileSync(viaMcp.files.html, 'utf8')),
      'the MCP path never takes a folder or a stamp');

    // ── save_project / load_project: Windows 장치 이름(기록 갈래의 segmentError 한 규칙) ────────────
    for (const nm of ['NUL.json', 'CON.stcfsd', 'com1.json', 'Lpt3.JSON', 'NUL', 'AUX.json', 'COM².json', 'prn.tmp.json']) {
      const fp = path.join(dir, nm);
      const sv = await p.handleMcpAction({ action: 'save_project', filepath: fp });
      // 확장자가 없으면 확장자 규칙이 먼저 거절한다 — 어느 쪽이든 쓰지 않는다
      const why = nm.includes('.') ? /device name/ : /device name|extension/;
      assert(sv.error && why.test(sv.error), `save_project refuses the device name ${nm}: ${JSON.stringify(sv).slice(0, 200)}`);
      const ld = await p.handleMcpAction({ action: 'load_project', filepath: fp });
      assert(ld.error && why.test(ld.error), `load_project refuses the device name ${nm}: ${JSON.stringify(ld).slice(0, 200)}`);
    }
    const okSave = await p.handleMcpAction({ action: 'save_project', filepath: path.join(dir, 'console-ok.json') });
    assert(okSave.success, `an ordinary name is still accepted: ${JSON.stringify(okSave).slice(0, 200)}`);
    for (const nm of ['NUL', 'con.report', 'COM1']) { assert(/^_/.test(RF.safeBaseName(nm)), `report base name ${nm} is not a device`); }

    // ── 3. 좌굴 보고서, 화면 없이 ───────────────────────────────────────────
    const b = await p.handleMcpAction({ action: 'generate_report', kind: 'buckling', format: 'html', detail: 'full' });
    assert(!b.error, b.error);
    assert(/화면 없이 만든 보고서/.test(b.html) && /<svg/.test(b.html), 'headless buckling report: signature curve SVG and the note');
    assert(/\.buckling\.r\d+\.html$/.test(b.files.html));
    console.log(`k3_host_review: PASS (${results.join('; ')})`);
  } finally {
    ctx.close();
  }
}

main().catch((e) => { console.error('k3_host_review: FAIL', e); process.exitCode = 1; });
