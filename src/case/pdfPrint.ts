/**
 * V7-02 · V7-03: HTML → PDF 를 닫힌 브라우저로(시스템 Edge / Chrome headless).
 *
 * - 문서에 CSP 를 넣는다(default-src 'none' — 인라인 스타일과 data: 그림만). 이미 있어도 앞에 한 번 더(가장 좁은 것이 이긴다).
 * - 브라우저: 스크립트는 문서의 CSP 가 막는다(아래 withCsp), 이름 풀이 없음(모든 이름 → NOTFOUND), 모든 요청은 닿지 않는 프록시로
 *   (루프백 포함 — `<-loopback>`), 배경 통신 · 확장 · 동기화 · 구성요소 갱신 끔, 첫 실행 · 기본 브라우저 확인 없음.
 *   샌드박스는 끄지 않는다(옛 `--no-sandbox` 는 까닭 없이 있던 것 — 이 PC 에서 샌드박스 켠 채 인쇄된다; 시험이 그것을 돈다).
 * - 파일: 이 인쇄만의 임시 폴더(mkdtemp) 안에 문서 하나와 버릴 프로필. 주소는 url.pathToFileURL(`#` · `%` 가 든 경로 — V7-13).
 *   다른 파일은 CSP(default-src 'none')가 막는다 — 문서가 읽을 수 있는 것은 자기 자신뿐.
 * - 지키미: PDF 크기가 멈춘 뒤 stableMs, 또는 전체 timeoutMs 가 지나면 **프로세스 나무 전체**(그 임시 폴더 이름이 명령줄에 든 모든
 *   프로세스 — 렌더러 · crashpad 포함)를 끝내고 임시 폴더를 지운다. 끝나지 않으면 예외가 아니라 { ok: false, error }.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * 문서의 맨 앞(DOCTYPE 바로 뒤)에 CSP meta — 그 앞에 스크립트가 올 자리가 없다. 파서는 이 meta 를 head 로 넣고, 그 뒤의 모든 것에 적용한다.
 * (스크립트를 끄는 브라우저 인자 --blink-settings=scriptEnabled=false 는 headless 의 --print-to-pdf 를 멈춘다 — 이 PC 의 Edge 에서
 *  PDF 가 나오지 않았다. 그래서 스크립트는 CSP(script-src 없음 → 'none')로 막는다.)
 */
export function withCsp(html: string): string {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`;
    // meta refresh 는 CSP 가 막지 않는 이동이다 — 이름을 바꿔 죽인다(우리 보고서에는 없다)
    const body = html.replace(/<meta\b([^>]*?)\bhttp-equiv\s*=\s*(["']?)\s*refresh/gi, '<meta$1data-blocked-http-equiv=$2refresh');
    const m = /^\s*<!DOCTYPE[^>]*>/i.exec(body);
    return m ? body.slice(0, m[0].length) + meta + body.slice(m[0].length) : meta + body;
}

/**
 * CSP 와 따로 서는 둘째 막음(V8-02 — 정규식이 아니라 토큰으로): 인쇄하는 문서를 HTML 의 토큰(글 · 시작 태그 · 끝 태그 · 주석 · DOCTYPE)으로
 * 읽어 **허용 목록에 든 요소 · 속성만** 남긴다. 속성 값은 따옴표("" · '') · 따옴표 없는 꼴을 HTML 처럼 읽는다 — 따옴표 안의 `>` 가 태그를
 * 끝내지 않는다(`<details title=">" open ontoggle=…>` 의 ontoggle 은 속성으로 읽혀 지워진다).
 *  - 요소: 보고서 그리기(reportRender.js) · 인쇄 틀이 쓰는 것만. 그 밖의 태그는 글(&lt;)로. 주석은 지운다. DOCTYPE 은 `<!DOCTYPE html>` 만.
 *  - 속성: 이름의 허용 목록(이벤트 · href · src · xlink · srcset · formaction … 은 목록에 없다). img 의 src 는 data:image/png;base64 만.
 *  - CSS(`style` 속성 · `<style>` 블록): 역빗금(CSS 이스케이프 — `\75rl(`), `&`(속성의 글자 참조), `<`, `url(` · `image-set` ·
 *    `@import` · `expression(` · `src(` · `//`(프로토콜 없는 주소)가 있으면 그 속성 · 블록을 지운다.
 *  - 그 밖의 속성 값에 `url(` · `javascript:` · `expression(` 이 있으면 지운다. meta 는 charset="utf-8" 과 CSP 만.
 * 허용한 태그는 **원문 그대로** 남긴다(보고서 그리기가 만든 문서는 한 글자도 바뀌지 않는다 — 시험이 본다). 속성을 지운 태그만 다시 짓는다.
 */
const PRINT_TAGS = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'h1', 'h2', 'h3', 'h4', 'p', 'table', 'tbody', 'thead', 'tr', 'th', 'td',
    'div', 'span', 'ul', 'ol', 'li', 'b', 'i', 'em', 'strong', 'hr', 'br', 'sub', 'sup', 'small', 'dl', 'dt', 'dd', 'details', 'summary', 'pre', 'code',
    'svg', 'g', 'line', 'circle', 'path', 'rect', 'text', 'polygon', 'polyline', 'ellipse', 'img', 'tspan', 'caption', 'colgroup', 'col', 'tfoot']);
const PRINT_ATTRS = new Set(['class', 'id', 'style', 'title', 'lang', 'colspan', 'rowspan', 'width', 'height', 'viewbox', 'preserveaspectratio', 'xmlns',
    'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity',
    'fill-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-anchor',
    'dominant-baseline', 'alignment-baseline', 'transform', 'open', 'dx', 'dy', 'charset', 'http-equiv', 'content', 'src', 'span', 'align', 'valign']);
const CSS_BAD = /[\\<&]|url\s*\(|image-set|@import|expression\s*\(|\bsrc\s*\(|\/\//i;
const VALUE_BAD = /url\s*\(|javascript:|vbscript:|expression\s*\(/i;
const PNG_SRC = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;

interface Attr { name: string; value: string | null }
/** 시작 태그 하나를 `<` 자리부터 읽는다(HTML 토크나이저의 속성 규칙). 끝나지 않으면 null */
function readStartTag(html: string, at: number): { end: number; name: string; attrs: Attr[]; selfClose: boolean } | null {
    let i = at + 1;
    const nm = /^[a-zA-Z][^\s/>\0]*/.exec(html.slice(i, i + 64));
    if (!nm) { return null; }
    const name = nm[0];
    i += name.length;
    const attrs: Attr[] = [];
    let selfClose = false;
    const ws = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
    while (i < html.length) {
        const c = html[i];
        if (ws(c)) { i += 1; continue; }
        if (c === '>') { return { end: i + 1, name, attrs, selfClose }; }
        if (c === '/') { selfClose = html[i + 1] === '>'; i += 1; continue; }
        // 속성 이름: 공백 · / · > · = 까지(첫 글자가 = 이면 이름에 든다 — HTML 그대로)
        let j = i + 1;
        while (j < html.length && !ws(html[j]) && html[j] !== '/' && html[j] !== '>' && html[j] !== '=') { j += 1; }
        const an = html.slice(i, j);
        i = j;
        while (i < html.length && ws(html[i])) { i += 1; }
        if (html[i] !== '=') { attrs.push({ name: an, value: null }); continue; }
        i += 1;
        while (i < html.length && ws(html[i])) { i += 1; }
        const q = html[i];
        if (q === '"' || q === "'") {
            const close = html.indexOf(q, i + 1);
            if (close < 0) { return null; }
            attrs.push({ name: an, value: html.slice(i + 1, close) });
            i = close + 1;
        } else {
            let k = i;
            while (k < html.length && !ws(html[k]) && html[k] !== '>') { k += 1; }
            attrs.push({ name: an, value: html.slice(i, k) });
            i = k;
        }
    }
    return null;
}

const escAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** 시작 태그 → 남길 꼴(원문 · 다시 지은 것) 또는 지움('') */
function cleanStartTag(raw: string, tag: string, attrs: Attr[]): string {
    if (tag === 'meta') {
        const m = new Map(attrs.map((a) => [a.name.toLowerCase(), a.value]));
        if (attrs.length === 1 && String(m.get('charset')).toLowerCase() === 'utf-8') { return raw; }
        if (attrs.length === 2 && String(m.get('http-equiv')).toLowerCase() === 'content-security-policy' && typeof m.get('content') === 'string'
            && !/[<>]/.test(m.get('content') as string)) { return raw; }
        return '';
    }
    if (tag === 'img') {
        const src = attrs.find((a) => a.name.toLowerCase() === 'src');
        return src && src.value !== null && PNG_SRC.test(src.value) ? `<img src="${src.value}">` : '';
    }
    let changed = false;
    const keep: Attr[] = [];
    const seen = new Set<string>();
    for (const a of attrs) {
        const n = a.name.toLowerCase();
        // HTML 은 겹친 이름의 첫 것만 쓴다 — 겹친 것도 허용 목록을 지나야 원문을 남기고(뜻이 같다), 다시 지을 때는 버린다
        if (seen.has(n)) { if (!PRINT_ATTRS.has(n) || (n === 'style' && CSS_BAD.test(a.value ?? '')) || VALUE_BAD.test(a.value ?? '')) { changed = true; } continue; }
        seen.add(n);
        const v = a.value ?? '';
        let ok = PRINT_ATTRS.has(n) && n !== 'src' && n !== 'charset' && n !== 'http-equiv' && n !== 'content';
        if (ok && n === 'style') { ok = !CSS_BAD.test(v); }
        else if (ok && n === 'xmlns') { ok = v === 'http://www.w3.org/2000/svg'; }
        else if (ok) { ok = !VALUE_BAD.test(v) && !(/[&\\]/.test(v) && !['title', 'class', 'id'].includes(n)); }
        if (ok) { keep.push(a); } else { changed = true; }
    }
    if (!changed) { return raw; }
    return `<${tag}${keep.map((a) => (a.value === null ? ` ${a.name.toLowerCase()}` : ` ${a.name.toLowerCase()}="${escAttr(a.value)}"`)).join('')}>`;
}

export function sanitizeForPrint(html: string): string {
    let out = '';
    let i = 0;
    const n = html.length;
    while (i < n) {
        const lt = html.indexOf('<', i);
        if (lt < 0) { out += html.slice(i); break; }
        out += html.slice(i, lt);
        i = lt;
        if (html.startsWith('<!--', i)) {                      // 주석 — 지운다(끝: --> · --!>, 없으면 끝까지)
            const m = /--!?>/.exec(html.slice(i + 4));
            i = m ? i + 4 + m.index + m[0].length : n;
            continue;
        }
        if (/^<!DOCTYPE html>/i.test(html.slice(i, i + 15))) { out += html.slice(i, i + 15); i += 15; continue; }
        if (html.startsWith('<!', i) || html.startsWith('<?', i)) { // 그 밖의 선언 · CDATA · 처리 지시 — > 까지 지운다
            const e = html.indexOf('>', i);
            i = e < 0 ? n : e + 1;
            continue;
        }
        if (html[i + 1] === '/') {                              // 끝 태그
            const m = /^<\/([a-zA-Z][^\s/>\0]*)[^>]*>/.exec(html.slice(i));
            if (!m) { out += '&lt;'; i += 1; continue; }
            const tag = m[1].toLowerCase();
            out += PRINT_TAGS.has(tag) ? `</${tag}>` : '&lt;' + m[0].slice(1);
            i += m[0].length;
            continue;
        }
        const st = readStartTag(html, i);
        if (!st) { out += '&lt;'; i += 1; continue; }           // 태그가 아니다(또는 끝나지 않았다) — 글
        const raw = html.slice(i, st.end);
        const tag = st.name.toLowerCase();
        i = st.end;
        if (!PRINT_TAGS.has(tag)) { out += '&lt;' + raw.slice(1); continue; }
        if (tag === 'style') {                                  // 원시 글 — </style 까지. 이상한 CSS · < 가 있으면 블록째 지운다
            const close = html.slice(i).search(/<\/style\s*>/i);
            const css = close < 0 ? html.slice(i) : html.slice(i, i + close);
            const endTag = close < 0 ? '' : /^<\/style\s*>/i.exec(html.slice(i + close))![0];
            i = close < 0 ? n : i + close + endTag.length;
            const opened = cleanStartTag(raw, tag, st.attrs);
            if (!CSS_BAD.test(css) && opened === raw) { out += raw + css + endTag; }
            continue;
        }
        out += cleanStartTag(raw, tag, st.attrs);
    }
    return out;
}

/** 인쇄 브라우저의 인자(시험이 그대로 본다). profile · pdfPath · url 은 호출자가 */
export function printArgs(profile: string, pdfPath: string, url: string): string[] {
    return [
        '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
        '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-default-apps',
        '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
        '--disable-client-side-phishing-detection', '--dns-prefetch-disable',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
        // V8-02: WebRTC 의 UDP 는 죽은 프록시 · 이름 풀이 규칙을 타지 않는다 — 프록시를 거치지 않는 UDP 를 끈다(프록시는 닿지 않는 곳)
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--print-to-pdf=' + pdfPath,
        url,
    ];
}

/** 명령줄에 marker(이 인쇄의 임시 폴더 이름)가 든 프로세스를 모두 끝낸다(Windows). 끝낸 pid 목록 */
export function killByMarker(marker: string): number[] {
    if (!/^[A-Za-z0-9_-]+$/.test(marker)) { return []; }
    if (process.platform !== 'win32') {
        try { cp.spawnSync('pkill', ['-9', '-f', marker], { stdio: 'ignore' }); } catch { /* 없음 */ }
        return [];
    }
    const ps = `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.ProcessId -ne $PID }; `
        + `$p | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }; ($p | ForEach-Object { $_.ProcessId }) -join ','`;
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    return String(r.stdout || '').trim().split(',').filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
}

function rmTree(dir: string): boolean {
    for (let i = 0; i < 20; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 잠김 — 다시 */ }
        if (!fs.existsSync(dir)) { return true; }
        const until = Date.now() + 250; while (Date.now() < until) { /* 잠깐 */ }
    }
    return !fs.existsSync(dir);
}

export interface PrintOptions {
    timeoutMs?: number; stableMs?: number; argsPrefix?: string[]; onSpawn?: (pid: number, marker: string) => void;
    /** 시험 전용 — 호스트는 주지 않는다 */
    unsafeTestOnly?: { noCsp?: boolean; noSanitize?: boolean };
}
export type PrintResult = { ok: true } | { ok: false; error: string };

export async function printHtmlToPdf(browserPath: string, html: string, pdfPath: string, opt: PrintOptions = {}): Promise<PrintResult> {
    const timeoutMs = opt.timeoutMs ?? 120000, stableMs = opt.stableMs ?? 15000;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cufsm_pdf_'));
    const marker = path.basename(dir);
    const doc = path.join(dir, 'report.html');
    const profile = path.join(dir, 'profile');
    fs.mkdirSync(profile);
    // 시험만: 막음 하나씩 빼고 나머지(브라우저 인자)가 혼자 서는지 본다 — 제품 경로는 늘 둘 다
    const body = opt.unsafeTestOnly?.noSanitize ? html : sanitizeForPrint(html);
    fs.writeFileSync(doc, opt.unsafeTestOnly?.noCsp ? body : withCsp(body), 'utf-8');
    const before = (() => { try { return fs.statSync(pdfPath).mtimeMs; } catch { return -1; } })();
    const result = await new Promise<PrintResult>((resolve) => {
        let done = false, timedOut = false;
        const finish = (r: PrintResult) => { if (!done) { done = true; resolve(r); } };
        let proc: cp.ChildProcess;
        try {
            proc = cp.spawn(browserPath, [...(opt.argsPrefix || []), ...printArgs(profile, pdfPath, pathToFileURL(doc).href)],
                { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
        } catch (e: any) { finish({ ok: false, error: 'the PDF printer could not start: ' + (e?.message || String(e)) }); return; }
        if (proc.pid && opt.onSpawn) { opt.onSpawn(proc.pid, marker); }
        const t0 = Date.now();
        let lastSize = -1, stableSince = 0;
        const watch = setInterval(() => {
            let size = -1;
            try { const st = fs.statSync(pdfPath); size = st.mtimeMs !== before ? st.size : -1; } catch { /* 아직 */ }
            if (size > 0 && size === lastSize) { stableSince = stableSince || Date.now(); } else { stableSince = 0; }
            lastSize = size;
            const stuck = stableSince && Date.now() - stableSince > stableMs;
            if (stuck || Date.now() - t0 > timeoutMs) {
                clearInterval(watch);
                timedOut = !stuck;
                if (process.platform === 'win32' && proc.pid) { cp.spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
                else { try { proc.kill('SIGKILL'); } catch { /* 이미 끝남 */ } }
                killByMarker(marker);
            }
        }, 500);
        proc.on('error', (err) => { clearInterval(watch); finish({ ok: false, error: 'the PDF printer failed: ' + err.message }); });
        proc.on('close', (code) => {
            clearInterval(watch);
            const check = (retries: number) => {
                try {
                    const st = fs.statSync(pdfPath);
                    if (st.size > 0 && st.mtimeMs !== before && !timedOut) { finish({ ok: true }); return; }
                } catch { /* 아직 */ }
                if (retries > 0 && !timedOut) { setTimeout(() => check(retries - 1), 500); return; }
                finish({ ok: false, error: timedOut
                    ? `PDF printing did not finish in ${Math.round(timeoutMs / 1000)} s — the printer was stopped and its files removed`
                    : `the PDF was not written (printer exit code ${code ?? 'unknown'})` });
            };
            setTimeout(() => check(10), 300);
        });
    });
    // 남은 프로세스(렌더러 · crashpad)와 임시 폴더 — 늘
    killByMarker(marker);
    rmTree(dir);
    return result;
}
