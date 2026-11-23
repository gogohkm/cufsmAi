/* global process, Buffer, setTimeout */
// V7-02 · V7-03 · V7-13 — 인쇄 브라우저는 닫혀 있다: 스크립트가 돌지 않고, 아무 데도 요청하지 않으며(루프백 듣개가 연결 0),
// 다른 파일을 싣지 않고, 끝나지 않으면 프로세스 나무 전체를 끝내고 임시 폴더를 지운다. 임시 폴더는 이 시험의 출력 폴더 안
// (TEMP · TMP 를 바꾼다 — 진짜 임시 폴더에 남기지 않는다). `#` · `%` 가 든 임시 경로에서도 인쇄된다.
// 그리고 ReportDoc 의 모든 글 칸에 넣은 공격 글이 보고서 · 검증 표에서 글로만 남는다(이스케이프).
'use strict';
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const cp = require('child_process');

const OUT = path.join(__dirname, '..', 'rendered', 'out', 'pdf_isolation');
fs.rmSync(OUT, { recursive: true, force: true });
const TMP = path.join(OUT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
process.env.TEMP = TMP; process.env.TMP = TMP;
const os = require('os');
assert.strictEqual(path.resolve(os.tmpdir()), path.resolve(TMP), 'the printer temp folder is the test folder');

const { loadTs, makeFakeVscode } = require('./panel_harness');
const PP = loadTs('src/case/pdfPrint.ts', makeFakeVscode());
const REVIEW = require('../../webview/js/review.js');
const RENDER = require('../../webview/js/reportRender.js');
const { pdfText } = require('../rendered/k3/pdftext.js');

const results = [];
const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find((p) => fs.existsSync(p));

function markerProcs(marker) {
  const ps = `(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.ProcessId -ne $PID } | Measure-Object).Count`;
  return Number(String(cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true }).stdout).trim() || 0);
}
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => /^cufsm_pdf_/.test(n));

// ── 공격 글(모든 칸에) ────────────────────────────────────────────────────
const PAYLOADS = ['<script>document.write("SCRIPT-RAN-9X")</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>',
  'javascript:alert(1)', '<a href="javascript:alert(1)">x</a>', 'data:text/html,<script>alert(1)</script>', '<style>@import url(http://127.0.0.1:1/x)</style>',
  'x{background:url(http://127.0.0.1:1/y)}', '&lt;script&gt;', '&#60;script&#62;', '\u202Eevil\u202C', 'A'.repeat(20000), '</td></tr></table><h1>forged</h1>',
  "</title></style></head><meta http-equiv=\"Content-Security-Policy\" content=\"script-src * 'unsafe-inline'\"><script>x</script><body>"];
const P = (i) => PAYLOADS[i % PAYLOADS.length];
function assertInert(html, where) {
  for (const p of PAYLOADS) { if (/[<>"]/.test(p)) { assert(!html.includes(p), `${where}: payload passed through: ${p.slice(0, 40)}`); } }
  assert(!/<script/i.test(html), `${where}: <script`);
  assert(!/<[^>]*\son[a-z]+\s*=/i.test(html), `${where}: an event-handler attribute`);
  assert(!/(?:href|src)\s*=\s*["']?\s*(?:javascript|data:text)/i.test(html), `${where}: a javascript: / data:text URL in an attribute`);
  assert(!/<(?:iframe|object|embed|link|base|form|meta(?![^>]*(?:Content-Security-Policy|charset=)))/i.test(html), `${where}: an active element`);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n') + [...html.matchAll(/\sstyle="([^"]*)"/gi)].map((m) => m[1]).join('\n');
  assert(!/@import|url\(/i.test(styles), `${where}: CSS import / url() in a style block or attribute`);
  assert(!/[\u202a-\u202e\u2066-\u2069]/.test(html), `${where}: bidi control characters`);
  assert(!/<h1>forged/.test(html), `${where}: markup injected`);
  assert((html.match(/<meta[^>]*Content-Security-Policy/gi) || []).length <= 1, `${where}: a second CSP meta`);
  if (/<head>/.test(html)) { assert(/^<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/.test(html), `${where}: the CSP is the first thing in the head`); }
  assert.strictEqual(PP.sanitizeForPrint(html), html, `${where}: the print allow-list keeps the renderer's document unchanged`);
}

async function t(name, fn) { try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, (e && e.message || String(e)).split('\n')[0]]); } }

(async () => {
  // 1. ReportDoc: 모든 글 칸에 공격 글
  await t('escaping — every text field of a ReportDoc stays text (report)', () => {
    let k = 0;
    const chk = { id: P(k++), name_ko: P(k++), clause: P(k++), equations: [P(k++)], verdict: 'fail', reason: P(k++), out_of_scope: P(k++), governs: true, governs_basis: P(k++),
      ratio_form: P(k++), combination: P(k++), steps_unavailable: P(k++), design_method: P(k++),
      demand: { symbol: P(k++), value: 1, quantity: 'force', source: { kind: 'load_analysis', combination: P(k++) } },
      nominal: { symbol: P(k++), value: 2, quantity: 'force' }, capacity: { symbol: P(k++), value: 3, quantity: P(k++) },
      factor: { symbol: P(k++), value: 0.9 }, highest_evaluated: { id: P(k++), ratio: 0.5, verdict: P(k++) },
      location: { region: P(k++), check_point: P(k++), segment: P(k++), x: { value: 1, quantity: 'length' } },
      steps: [{ kind: 'equation', expr: P(k++), equation: P(k++), note: P(k++), expr_units: 'US', units_note: P(k++),
        inputs: [{ symbol: P(k++), value: 1, quantity: 'stress', source: { kind: P(k++), key: P(k++) } }], result: { symbol: P(k++), value: 2, quantity: 'stress' } },
      { kind: 'branch', condition: P(k++), holds: true, equation: P(k++) }] };
    const doc = { schema: 'stcfsd-report/1', meta: { title: P(k++), date: P(k++), spec: P(k++), method: P(k++), design_method: P(k++), units: 'SI',
      stamp: { kind: 'draft', label: P(k++), reviewer: P(k++), date: P(k++) } }, verdict: null,
    sections: [{ id: 's', title: P(k++), blocks: [
      { kind: 'heading', text: P(k++) }, { kind: 'para', text: P(k++), tone: P(k++) },
      { kind: 'table', head: [P(k++), { text: P(k++) }], rows: [[P(k++), { text: P(k++), tone: '"><script>' }, { value: 1, quantity: P(k++) }, { unit_of: P(k++) }]], note: P(k++) },
      { kind: 'list', title: P(k++), items: [P(k++), { o: P(k++) }] }, { kind: 'check', check: chk },
      { kind: 'curve', L: { values: [1, 10], quantity: 'length' }, LF: { values: [1, 2], quantity: 'dimensionless' }, marks: [{ label: P(k++), L: { value: 1, quantity: 'length' }, LF: { value: 1, quantity: 'dimensionless' } }] },
      { kind: 'diagram', title: P(k++), color: '"><script>', x: { values: [0, 1], quantity: 'length_ft' }, y: { values: [0, 1], quantity: 'moment_ft' }, marks: [{ label: P(k++), x: { value: 0.5, quantity: 'length_ft' } }] },
      { kind: 'beam', spans: { values: [10], quantity: 'length_ft' }, supports: [P(k++), P(k)], laps: [] },
      { kind: 'image', src: 'javascript:alert(1)' }, { kind: 'image', src: 'data:image/svg+xml,<svg onload=alert(1)>' }, { kind: 'html', html: '<script>x</script>' },
    ] }] };
    assertInert(REVIEW.printableReportHtml(RENDER.renderReportDoc(doc)), 'report');
  });
  // 2. 검증 표
  await t('escaping — validation items (category, item, value, criterion, note)', () => {
    const items = PAYLOADS.map((p, i) => ({ category: p, item: P(i + 1), status: i % 2 ? 'warn' : 'fail', value: P(i + 2), criterion: P(i + 3), note: P(i + 4) }));
    const R = REVIEW.make({ doc: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }, unitSystem: 'US' });
    assertInert(R.renderValidationDashboard(items), 'validation');
  });
  // 3. 인쇄 인자: 샌드박스를 끄지 않는다, 스크립트 끔, 통신 막음
  await t('print arguments — sandbox on, scripts blocked by the CSP, no DNS, every request to a dead proxy', () => {
    const a = PP.printArgs('C:\\p', 'C:\\o.pdf', 'file:///C:/x.html');
    assert(!a.includes('--no-sandbox'), 'no --no-sandbox');
    for (const f of ['--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      '--disable-background-networking', '--disable-extensions', '--disable-component-update']) { assert(a.includes(f), f); }
    assert(PP.withCsp('<!DOCTYPE html><script>x</script><html>').startsWith(`<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${PP.REPORT_CSP}"><script>`), 'CSP before anything else');
    assert(PP.withCsp('<script>x</script>').startsWith('<meta http-equiv="Content-Security-Policy"'), 'CSP first without a DOCTYPE');
    assert(/Content-Security-Policy[^>]*default-src 'none'/.test(REVIEW.printableReportHtml('')), 'the report document carries its own CSP');
  });
  // 3b. V8-02: 허용 목록은 토큰으로 — 따옴표 안의 > · CSS 이스케이프 · 프로토콜 없는 주소 · image-set 문자열 · svg 안의 style · 주석
  await t('allow-list (V8-02) — quoted ">" does not end a tag; CSS escapes, //host, image-set strings, svg style, comments are removed', () => {
    const cases = [
      ['<details title=">" open ontoggle="document.body.append(\'JSRAN\')">x</details>', (o) => !/ontoggle/i.test(o) && /<details/.test(o)],
      ['<div style="background:\\75rl(//127.0.0.1/x)">a</div>', (o) => !/style=/.test(o)],
      ['<div style="background:url(//evil.example/x)">a</div>', (o) => !/style=/.test(o)],
      ['<div style="background-image:image-set(\'x.png\' 1x)">a</div>', (o) => !/style=/.test(o)],
      ['<div style="background-image:-webkit-image-set(&quot;//h/x&quot; 1x)">a</div>', (o) => !/style=/.test(o)],
      ['<style>div{background:\\75rl(x)}</style><p>k</p>', (o) => !/<style/.test(o) && /<p>k/.test(o)],
      ['<style>div{background:image-set("http://h/x" 1x)}</style>', (o) => !/<style/.test(o)],
      ['<style>div{background://h/x}</style>', (o) => !/<style/.test(o)],
      ['<svg><style><img src=x onerror=alert(1)></style></svg>', (o) => !/onerror/.test(o) && !/<style/.test(o)],
      ['<!--<img src=x onerror=alert(1)>--><p>after</p>', (o) => !/onerror/.test(o) && /<p>after/.test(o)],
      ['<p title=a>b onclick=x>t</p>', (o) => !/<p[^>]*onclick/i.test(o)],
      ['<rect fill="url(http://h/x)" x="1"/>', (o) => !/url\(/.test(o) && /x="1"/.test(o)],
      ['<svg xmlns="http://evil.example"><g/></svg>', (o) => !/evil/.test(o)],
      ['<img src="data:image/svg+xml,<svg onload=alert(1)>">', (o) => !/<img/.test(o)],
      ['<p onclick = "x" ONCLICK="y" class="ok">t</p>', (o) => /^<p class="ok">t<\/p>$/.test(o)],
      ['<meta http-equiv="refresh" content="0;url=http://h/">', (o) => o === ''],
      ['<![CDATA[<img src=x onerror=1>]]><p>c</p>', (o) => !/onerror/.test(o)],
      ['<p>unterminated <div title="abc', (o) => !/<div/.test(o)],
    ];
    for (const [input, ok] of cases) {
      const out = PP.sanitizeForPrint(input);
      assert(ok(out), `${input} → ${out}`);
    }
    // 보고서 그리기가 만든 문서는 한 글자도 바뀌지 않는다(위 escaping 시험의 assertInert 가 같은 것을 본다)
    const real = REVIEW.printableReportHtml(RENDER.renderReportDoc({ schema: 'stcfsd-report/1', meta: { title: 'T', units: 'US' }, verdict: null,
      sections: [{ id: 's', title: 'S', blocks: [{ kind: 'para', text: 'p' }, { kind: 'table', head: ['a'], rows: [['1']] }] }] }));
    assert.strictEqual(PP.sanitizeForPrint(real), real);
  });
  await t('print arguments (V8-02) — WebRTC: no UDP outside the (dead) proxy', () => {
    const a = PP.printArgs('C:\\p', 'C:\\o.pdf', 'file:///C:/x.html');
    assert(a.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp') && a.includes('--webrtc-ip-handling-policy=disable_non_proxied_udp'));
  });
  if (!browser) { results.push(['skip', 'real print (no Edge / Chrome)']); }
  else {
    // 4. 진짜 인쇄: 공격 문서(이스케이프와 상관없이 — 브라우저 쪽 막음을 본다). 막음을 하나씩 빼도 나머지가 혼자 서는지:
    //    (a) 모두, (b) CSP 없이(허용 목록 + 브라우저 인자), (c) CSP · 허용 목록 없이(브라우저 인자만 — 통신은 막혀야 한다)
    let conns = 0;
    const srv = net.createServer((s) => { conns++; s.destroy(); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const secret = path.join(OUT, 'secret.txt');
    fs.writeFileSync(secret, 'SECRET-7Q3 foreign file');
    const u = (p) => `http://127.0.0.1:${port}/${p}`;
    const fileUrl = require('url').pathToFileURL(secret).href;
    const hostile = `<!DOCTYPE html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${u('css')}"><meta http-equiv="refresh" content="0;url=${u('refresh')}">
<style>@import url(${u('import')}); body{background:url(${u('bg')})}</style><base href="${u('base/')}"></head><body>
<p>VISIBLE-OK</p><script>document.body.innerHTML += 'RAN' + 'NOW'; fetch('${u('fetch')}'); new Image().src='${u('img2')}'; for(;;){}</script>
<img src="${u('img')}"><img src="${fileUrl}"><iframe src="${fileUrl}"></iframe><object data="${fileUrl}"></object><embed src="${u('embed')}">
<svg onload="fetch('${u('svg')}')"><image href="${u('svgimg')}"/></svg><video src="${u('vid')}"></video><audio src="${u('aud')}"></audio>
<a href="javascript:fetch('${u('js')}')">a</a><link rel="prefetch" href="${u('prefetch')}"><link rel="dns-prefetch" href="//evil.example"><img src="http://evil.example/x.png"></body></html>`;
    const hostileRun = async (name, unsafe, timeoutMs) => {
      conns = 0;
      const pdf = path.join(OUT, name + '.pdf');
      const t0 = Date.now();
      // 브라우저 인자만: 끝없는 고리 · meta refresh 를 빼야 인쇄가 끝나 남는 위험(스크립트 · 다른 파일)을 잴 수 있다
      const doc = unsafe.noSanitize ? hostile.replace('for(;;){}', '').replace(/<meta http-equiv="refresh"[^>]*>/, '') : hostile;
      const r = await PP.printHtmlToPdf(browser, doc, pdf, { unsafeTestOnly: unsafe, ...(timeoutMs ? { timeoutMs } : {}) });
      await new Promise((res) => setTimeout(res, 1500));
      const text = r.ok ? (pdfText(fs.readFileSync(pdf)).texts || []).join(String.fromCharCode(10)) : '';
      return { r, text, conns, ms: Date.now() - t0 };
    };
    for (const [name, unsafe] of [['all layers', {}], ['no CSP', { noCsp: true }]]) {
      await t(`real print (${name}) — a hostile page executes nothing, requests nothing, embeds no other file`, async () => {
        const o = await hostileRun('hostile-' + name.replace(/W/g, ''), unsafe);
        assert(o.r.ok, 'printed: ' + JSON.stringify(o.r));
        assert(/VISIBLE-OK/.test(o.text), 'the page printed');
        assert(!/RANNOW/.test(o.text), 'no script ran');
        assert(!/SECRET-7Q3/.test(o.text), 'no other local file embedded');
        assert.strictEqual(o.conns, 0, `the loopback listener got ${o.conns} connections`);
        assert.deepStrictEqual(leftovers(TMP), [], 'no printer folder left');
        results.push(['info', `${name}: printed in ${o.ms} ms, 0 connections`]);
      });
    }
    await t('real print (browser arguments only — no CSP, no allow-list) — still no network', async () => {
      const o = await hostileRun('hostile-flagsonly', { noCsp: true, noSanitize: true }, 20000);
      assert.strictEqual(o.conns, 0, `the loopback listener got ${o.conns} connections`);
      assert.deepStrictEqual(leftovers(TMP), [], 'no printer folder left');
      results.push(['info', `browser arguments only: ${o.conns} connections; printed ${o.r.ok}; script ran ${/RANNOW/.test(o.text)}; other file embedded ${/SECRET-7Q3/.test(o.text)} (${o.ms} ms)`]);
    });
    // 4b. V8-02: 검증자의 문서 — 막음을 하나씩 빼고(모두 · CSP 없이 · 브라우저 인자만), 루프백 TCP · UDP 듣개로
    {
      let udp = 0;
      const sock = dgram.createSocket('udp4');
      sock.on('message', () => { udp++; });
      await new Promise((r) => sock.bind(0, '127.0.0.1', r));
      const uport = sock.address().port;
      const v8doc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>V8-VISIBLE</p>
<details title=">" open ontoggle="document.body.append('JS'+'RAN');new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${uport}'}]}).createDataChannel('x')">d</details>
<div style="background:\\75rl(//127.0.0.1:${port}/esc)">e</div><div style="background-image:image-set('http://127.0.0.1:${port}/set' 1x)">f</div>
<div style="background:url(//127.0.0.1:${port}/pr)">g</div>
<script>(async()=>{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${uport}'}]});pc.createDataChannel('x');await pc.setLocalDescription(await pc.createOffer());document.body.append('RTC'+'TRIED');})()</script>
</body></html>`;
      for (const [name, unsafe] of [['all layers', {}], ['no CSP', { noCsp: true }], ['browser arguments only', { noCsp: true, noSanitize: true }]]) {
        await t(`real print V8-02 (${name}) — no script from a quoted ">", no request from CSS escapes · //host · image-set, no WebRTC UDP`, async () => {
          conns = 0; udp = 0;
          const pdf = path.join(OUT, 'v8-' + name.replace(/\W/g, '') + '.pdf');
          const r = await PP.printHtmlToPdf(browser, v8doc, pdf, { unsafeTestOnly: unsafe, timeoutMs: 30000 });
          await new Promise((res) => setTimeout(res, 2500));
          const text = r.ok ? (pdfText(fs.readFileSync(pdf)).texts || []).join(String.fromCharCode(10)) : '';
          assert(r.ok && /V8-VISIBLE/.test(text), `printed with the WebRTC flags: ${JSON.stringify(r)}`);
          if (!unsafe.noSanitize) { assert(!/JSRAN|RTCTRIED/.test(text), 'no script ran'); }
          assert.strictEqual(conns, 0, `TCP connections ${conns}`);
          assert.strictEqual(udp, 0, `UDP datagrams ${udp}`);
          results.push(['info', `V8-02 ${name}: TCP ${conns}, UDP ${udp}, script ran ${/JSRAN|RTCTRIED/.test(text)}`]);
        });
      }
      sock.close();
    }
    srv.close();
    // 5. 공격 글을 담은 보고서 — 인쇄해도 아무것도 돌지 않는다
    await t('real print — the payload report prints as text', async () => {
      const doc = { schema: 'stcfsd-report/1', meta: { title: 'PAYLOAD-REPORT', units: 'US' }, verdict: null,
        sections: [{ id: 's', title: PAYLOADS[0], blocks: PAYLOADS.slice(0, 11).map((p) => ({ kind: 'para', text: p })) }] };
      const pdf = path.join(OUT, 'payload.pdf');
      const r = await PP.printHtmlToPdf(browser, REVIEW.printableReportHtml(RENDER.renderReportDoc(doc)), pdf);
      assert(r.ok, JSON.stringify(r));
      const text = (pdfText(fs.readFileSync(pdf)).texts || []).join(String.fromCharCode(10));
      assert(/PAYLOAD-REPORT/.test(text) && /document\.write/.test(text), 'the payload is printed as text');
      assert(!/^SCRIPT-RAN-9X$/m.test(text.replace(/document\.write\("SCRIPT-RAN-9X"\)/g, '')), 'not executed');
    });
    // 6. `#` · `%` 가 든 임시 경로(V7-13)
    await t('real print — a temp path with # and % prints', async () => {
      const odd = path.join(OUT, 'C#dev %41');
      fs.mkdirSync(odd, { recursive: true });
      process.env.TEMP = odd; process.env.TMP = odd;
      try {
        const pdf = path.join(OUT, 'odd.pdf');
        const r = await PP.printHtmlToPdf(browser, '<html><head></head><body>ODD-PATH-OK</body></html>', pdf);
        assert(r.ok, JSON.stringify(r));
        assert(/ODD-PATH-OK/.test((pdfText(fs.readFileSync(pdf)).texts || []).join(String.fromCharCode(10))));
        assert.deepStrictEqual(leftovers(odd), []);
      } finally { process.env.TEMP = TMP; process.env.TMP = TMP; }
    });
  }
  // 7. 지키미: 끝나지 않는 인쇄기(자식도 하나) — 나무 전체를 끝내고 폴더를 지운다, 예외가 아니라 { ok: false }
  await t('watchdog — a printer that never finishes: whole tree killed, folder removed, an error not a throw', async () => {
    const hang = path.join(OUT, 'hang.js');
    fs.writeFileSync(hang, "const cp=require('child_process');if(!process.argv.includes('--child')){cp.spawn(process.execPath,[__filename,'--child',...process.argv.slice(2)],{stdio:'ignore'});}setInterval(()=>{},1000);");
    let marker = null;
    const t0 = Date.now();
    const r = await PP.printHtmlToPdf(process.execPath, '<html></html>', path.join(OUT, 'never.pdf'), { timeoutMs: 3000, argsPrefix: [hang], onSpawn: (_pid, m) => { marker = m; } });
    assert(!r.ok && /did not finish/.test(r.error), JSON.stringify(r));
    assert(marker, 'spawned');
    assert.strictEqual(markerProcs(marker), 0, 'no process of that print left');
    assert.deepStrictEqual(leftovers(TMP), [], 'no printer folder left');
    results.push(['info', `watchdog stopped the hung printer in ${Date.now() - t0} ms`]);
  });

  const bad = results.filter((r) => r[0] === 'FAIL');
  for (const r of results) { console.log(`  ${r[0]}  ${r[1]}${r[2] ? ' — ' + r[2] : ''}`); }
  fs.rmSync(OUT, { recursive: true, force: true });
  console.log(`pdf_isolation: ${bad.length ? 'FAIL' : 'PASS'} (${results.filter((r) => r[0] === 'ok').length} ok)`);
  if (bad.length) { process.exitCode = 1; }
})();
void Buffer;
