/* global process, console, Buffer */
// K3 0단계 — 「검증 · 보고서를 호스트로」 구현 전에 지금 동작을 고정하는 시험의 공용 도구(제품 코드는 읽기만 한다).
//  - 세션 · MCP 사슬은 K2 의 것(test/rendered/k2/k2lib.js)을 그대로 쓴다 — 포트만 K3 의 자리(48060– · 9580–)로.
//  - 검증: 「설계 검증 실행」 을 누르고 화면의 표(validation-container)를 항목으로 되읽는다(분류 · 항목 · 판정 · 값 · 기준 · 주석).
//  - 보고서: 「상세 보고서 생성」 의 글(날짜를 지운 것) · 제목 · HTML 의 sha256, 「PDF 저장」 의 진짜 길(호스트 → 시스템 Edge
//    headless, windowsHide)로 만든 PDF 의 쪽 수와 글. 좌굴 보고서(별도 패널)의 글 · 그림 목록과 그 PDF.
//  - 고정값: test/rendered/k3/golden/*.json — expect 'pin'(K3 뒤에도 같아야) · 'k3-change'(K3 가 일부러 바꿀 지금 동작) · 'defect'.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const K = require('../k2/k2lib');
const { pdfText } = require('./pdftext');

const ROOT = K.ROOT;
const OUT = path.join(ROOT, 'test', 'rendered', 'out', 'k3');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const ARGV = process.argv.slice(2);
const RECORD_ALL = ARGV.includes('--record');
const ACCEPT = new Set((ARGV.find((a) => a.startsWith('--accept=')) || '').replace('--accept=', '').split(',').filter(Boolean));

let _n = 0;
/** K2 의 세션(진짜 호스트 · 파이썬 · 헤드리스 Edge) — 이름 앞에 k3-, 포트는 K3 의 자리. */
async function session(name) {
  _n += 1;
  const ctx = await K.session('k3-' + name, { httpPort: 48060 + _n, cdpPort: 9580 + _n });
  ctx.k3Dir = path.join(OUT, name);
  fs.mkdirSync(ctx.k3Dir, { recursive: true });
  return ctx;
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
// 보고서 머리의 「날짜: <toLocaleString>」 — 글 · HTML · PDF(조각난 줄을 한 줄로 편 뒤)에서 같은 꼴로 지운다
const normDate = (s) => String(s).replace(/날짜\s*:\s*[^<]*?\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?/g, '날짜: <DATE>');
const normIso = (s) => String(s).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ISO>');

/**
 * K3-2 그림자: 화면이 만든 것(검증 표 · 보고서 HTML)과 호스트가 검토 상태로 만든 것(__testReview)을 같은 브라우저로 그려 맞댄다.
 * 다르면 shadowProblems 에 — run.js 가 실패로 센다.
 */
const shadowProblems = [];
let shadowCount = 0;
async function shadow(ctx, what, containerId, hostHtml) {
  shadowCount += 1;
  const r = await ctx.eval(`(()=>{const c=document.getElementById(${JSON.stringify(containerId)}); const d=document.createElement('div');
    d.innerHTML=${JSON.stringify(hostHtml)}; return {page: c? c.innerHTML : '', host: d.innerHTML};})()`);
  // 화면은 모델 칸(단면 치수 · 반파장)을 modelLoaded 로 적을 때 10 자리, 단위 전환 · 상태로 적을 때 12 자리로 쓴다 — 호스트는 늘 12 자리.
  // 그 글만 다르다(값은 같다): 맞댈 때 10 자리 넘는 수를 10 자리로.
  const ten = (t) => t.replace(/\d+\.\d{6,}/g, (x) => String(Number(Number(x).toPrecision(10))));
  const page = ten(normDate(r.page)), host = ten(normDate(r.host));
  if (page !== host) {
    let i = 0; while (i < page.length && i < host.length && page[i] === host[i]) { i++; }
    shadowProblems.push(`${ctx.name}: ${what} — page …${JSON.stringify(page.slice(Math.max(0, i - 120), i + 160))}
        host …${JSON.stringify(host.slice(Math.max(0, i - 120), i + 160))}`);
  }
}
function hostReview(ctx) { return ctx.panel.__testReview(); }

/** 「설계 검증 실행」 → 화면 표를 항목으로. 트리에 보낸 수(treeUpdate)도. */
async function runValidation(ctx) {
  await ctx.tab('validation');
  const m = ctx.mark();
  await ctx.click('#btn-run-validation');
  // 호스트의 답(validationResult)을 기다린다 — 정해진 시간이 아니라(부하에서 300 ms 안에 오지 않은 일이 한 번 있었다)
  await ctx.waitMsg('validationResult', m.h2w, 20000);
  await ctx.settle(300);
  const r = await ctx.eval(`(()=>{const c=document.getElementById('validation-container'); const st={'✓':'pass','!':'warn','✗':'fail'}; const out=[];
    for (const blk of c.children) { const hdr=blk.firstElementChild; if (!hdr) continue; const cat=(hdr.childNodes[0]&&hdr.childNodes[0].textContent||'').trim();
      let last=null; for (const r of [...blk.querySelectorAll('tr')].slice(1)) { const td=r.children;
        if (td.length===4) { last={category:cat, item:td[1].innerText.trim(), status: st[td[0].innerText.trim()]||td[0].innerText.trim(), value:td[2].innerText.trim(), criterion:td[3].innerText.trim(), note:''}; out.push(last); }
        else if (td.length===2 && last) { last.note=td[1].innerText.replace(/^→\\s*/,'').trim(); } } }
    const b=document.getElementById('validation-summary-badge'); return {items: out, badge: b? b.innerText.trim(): null};})()`);
  const tree = ctx.log.w2h.slice(m.w2h).filter((x) => x.command === 'treeUpdate').map((x) => x.data).pop() || null;
  const R = require('../../../webview/js/review.js');
  const hv = hostReview(ctx);
  await shadow(ctx, 'validation', 'validation-container', R.make({ doc: null, unitSystem: 'SI' }).renderValidationDashboard(hv.validation));
  const count = (s) => r.items.filter((i) => i.status === s).length;
  return { ...r, tree, counts: { total: r.items.length, pass: count('pass'), warn: count('warn'), fail: count('fail') } };
}

/** 「상세 보고서 생성」 → 글 · 제목 · HTML 해시. 결과가 없으면 화면의 오류 글. */
async function runReport(ctx) {
  await ctx.tab('report');
  await ctx.click('#btn-generate-report');
  await ctx.settle(300);
  // 결과가 없으면 화면은 오류 글만(보고서를 만들지 않는다) — 그때는 맞대지 않는다
  const hasResult = await ctx.eval("!!document.querySelector('#report-container h1')");
  if (hasResult) { await shadow(ctx, 'report', 'report-container', hostReview(ctx).reportHtml); }
  return readReport(ctx);
}
async function readReport(ctx) {
  await ctx.tab('report');   // 보이지 않는 탭의 innerText 는 줄이 없다
  const r = await ctx.eval(`(()=>{const c=document.getElementById('report-container'); const p=document.getElementById('btn-print-report');
    return {html: c? c.innerHTML: '', text: c? c.innerText: '', heads: c? [...c.querySelectorAll('h1,h2,h3')].map(h=>h.tagName+' '+h.innerText.trim()) : [],
      svgs: c? c.querySelectorAll('svg').length : 0, tables: c? c.querySelectorAll('table').length : 0, printShown: p ? p.style.display !== 'none' : null};})()`);
  const html = normDate(r.html);
  const text = normDate(r.text).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { text, heads: r.heads, svgs: r.svgs, tables: r.tables, htmlSha: sha(html), htmlLength: html.length, printShown: r.printShown };
}

/** 파일이 생기고 크기가 멈출 때까지(호스트가 띄운 Edge 가 다 쓸 때까지). */
async function waitFile(f, timeout = 90000) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < timeout) {
    let size = -1;
    try { size = fs.statSync(f).size; } catch { /* 아직 */ }
    if (size > 0 && size === last) { return size; }
    last = size;
    await K.sleep(700);
  }
  throw new Error('file not written: ' + f);
}

function pdfSummary(f) {
  const t = pdfText(fs.readFileSync(f));
  return { pages: t.pages, bytesKB: Math.round(fs.statSync(f).size / 1024),
    text: t.texts.map((x) => normDate(x.replace(/\s+/g, ' ').trim())), compact: sha(normDate(t.texts.join(' ').replace(/\s+/g, ' ')).replace(/\s+/g, '')) };
}

/** 「PDF 저장」(보고서 탭) — 호스트의 진짜 길(저장 대화상자 → 임시 HTML → 시스템 Edge headless --print-to-pdf). */
async function reportPdf(ctx, name) {
  const f = path.join(ctx.k3Dir, name + '.pdf');
  try { fs.unlinkSync(f); } catch { /* */ }
  ctx.dialogs.nextSave = f;
  const w0 = ctx.log.w2h.length;
  await ctx.click('#btn-print-report');
  await ctx.settle(300);
  const msg = ctx.log.w2h.slice(w0).find((x) => x.command === 'saveReportPdf');
  await waitFile(f);
  await K.sleep(500);
  // K3-5: 인쇄용 HTML 은 호스트가 만든다(화면에 보낸 보고서를 review.js printableReportHtml 로) — 옛 화면은 saveReportPdf 의 html
  const printed = msg ? msg.data.html : require('../../../webview/js/review.js').printableReportHtml(ctx.panel._lastReportHtml || '');
  return { ...pdfSummary(f), printedHtmlSha: sha(normDate(printed)) };
}

/** 좌굴해석 결과 보고서(별도 패널) — 화면이 보낸 HTML, 그리고 그 패널의 「PDF 저장」 길(호스트의 _saveReportPdf). */
async function bucklingReport(ctx, name, withPdf) {
  const w0 = ctx.log.w2h.length;
  await ctx.tab('design');
  await ctx.click('#btn-view-buckling-report');
  await ctx.settle(300);
  const msg = ctx.log.w2h.slice(w0).find((x) => x.command === 'showBucklingReport');
  if (!msg) { return { sent: false, status: await ctx.text('#analysis-status') }; }
  // K3-5: 화면은 그림 · DSM 표만 보내고 호스트가 만든다 — 호스트가 패널에 연 HTML 을 읽는다(옛 화면은 msg.data.html)
  const html = String(msg.data.html || ctx.panel._bucklingReportHtml || '');
  const pngs = (html.match(/data:image\/png;base64,/g) || []).length;
  // K3-7: 좌굴 보고서에도 날짜가 있다(ReportDoc meta.date) — 다른 보고서처럼 지운다
  const clean = normDate(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '<png>'));
  const text = clean.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
  const out = { sent: true, text, heads: [...clean.matchAll(/<h[12]>([^<]*)<\/h[12]>/g)].map((x) => x[1]), pngs, htmlSha: sha(clean) };
  if (withPdf) {
    const f = path.join(ctx.k3Dir, name + '-buckling.pdf');
    try { fs.unlinkSync(f); } catch { /* */ }
    ctx.dialogs.nextSave = f;
    await ctx.panel._saveReportPdf({ html: ctx.panel._buildPrintableBucklingHtml() });
    await waitFile(f);
    // 캔버스 PNG(모드 형상 3D 등)는 그릴 때마다 바이트가 조금씩 다르다 — 크기는 빼고 쪽 수 · 글만
    const { bytesKB: _kb, ...pdf } = pdfSummary(f);
    void _kb;
    out.pdf = pdf;
  }
  return out;
}

/** 엔진 결과의 design_checks 판정 요약(검증 항목과 맞대는 데). */
function engineVerdicts(result) {
  const o = {};
  const walk = (r, pre) => {
    if (!r || typeof r !== 'object') { return; }
    if (Array.isArray(r.design_checks)) { for (const c of r.design_checks) { o[(pre || '') + c.id] = c.verdict + (c.governs ? '*' : ''); } }
  };
  walk(result, '');
  // 퍼린: 호스트가 쥔 결과는 구간 묶음(regions[].result — 대표 검토 지점의 design_checks)
  const regions = result && (Array.isArray(result.regions) ? result.regions : Array.isArray(result.purlin_regions) ? result.purlin_regions : null);
  if (regions) { regions.forEach((g, i) => walk(g && g.result, `region${i}:`)); }
  return o;
}

/** MCP 응답을 고정할 모양으로 — 키 · 크기(바이트, 시각을 지운 글) · 몇 값. */
function mcpShape(r) {
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const txt = normIso(r.text);
  return { isError: r.isError, bytes: Buffer.byteLength(txt), keys: Object.keys(d).sort(), detail: d.detail || null,
    checks: Array.isArray(d.checks) ? d.checks.length : null, errors: d.errors || null, error: d.error || null };
}

class Golden {
  constructor(name) {
    this.name = name;
    this.file = path.join(GOLDEN_DIR, name + '.json');
    this.old = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    this.entries = [];
    this.mismatch = [];
    this.fresh = !this.old;
  }
  check(id, value, meta = {}) {
    const expect = meta.expect || 'pin';
    const v = JSON.parse(JSON.stringify(value === undefined ? null : value));
    const prev = this.old && this.old.entries.find((e) => e.id === id);
    let entry = { id, expect, ...(meta.reason ? { reason: meta.reason } : {}), value: v };
    if (prev && !RECORD_ALL && !ACCEPT.has(id)) {
      if (JSON.stringify(prev.value) !== JSON.stringify(v)) {
        this.mismatch.push({ id, expect: prev.expect, reason: prev.reason, detail: firstDiff(prev.value, v) });
      }
      entry = { ...prev };
    } else if (prev && ACCEPT.has(id)) {
      entry = { id, expect: 'pin', ...(prev.reason ? { reason: prev.reason, accepted_from: prev.expect } : {}), value: v };
    } else if (!prev && this.old && !RECORD_ALL) {
      this.mismatch.push({ id, expect, reason: 'new entry (not in the golden file) — run with --record or --accept=' + id, detail: '' });
    }
    this.entries.push(entry);
    return v;
  }
  save() {
    if (!(this.fresh || RECORD_ALL || ACCEPT.size > 0)) { return false; }
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    const doc = { about: `K3 phase 0 golden — ${this.name}. Recorded from the current code; 'k3-change' entries are the behaviour K3 is meant to change, 'defect' entries are findings.`,
      recorded: new Date().toISOString().slice(0, 10), entries: this.entries };
    fs.writeFileSync(this.file, JSON.stringify(doc, null, 1) + '\n');
    return true;
  }
}

function firstDiff(a, b, p = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) { return null; }
  if (typeof a === 'string' && typeof b === 'string') {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) { i++; }
    return `${p || '(value)'}: …${JSON.stringify(a.slice(Math.max(0, i - 60), i + 80))} → …${JSON.stringify(b.slice(Math.max(0, i - 60), i + 80))}`;
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) { return `${p || '(value)'}: length ${a.length} → ${b.length}`; }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k); if (d) { return d; } }
  }
  return `${p || '(value)'}: ${JSON.stringify(a)?.slice(0, 160)} → ${JSON.stringify(b)?.slice(0, 160)}`;
}

module.exports = { shadowProblems, shadowStats: () => shadowCount, ROOT, OUT, GOLDEN_DIR, K, session, runValidation, runReport, readReport, reportPdf, bucklingReport, engineVerdicts, mcpShape,
  Golden, sha, normDate, RECORD_ALL, ACCEPT };
