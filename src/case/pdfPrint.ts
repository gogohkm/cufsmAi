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
 * CSP 와 따로 서는 둘째 막음: 인쇄하는 문서에 남길 수 있는 요소 · 속성의 허용 목록. 보고서 그리기(reportRender.js)와
 * 인쇄 틀(review.printableReportHtml · 좌굴 틀)이 쓰는 것만 남기고, 그 밖의 태그는 글(&lt;)로, 허용한 태그의 속성 가운데
 * 다른 자원을 가리킬 수 있는 것(on…= · href · srcdoc · xlink · javascript: · file: · http(s): · url( · @import · expression()은 지운다.
 * img 의 src 는 data:image/png;base64 만. <style> 블록 안의 url( · @import 는 블록째 지운다.
 * — CSP 를 어떻게든 넘어도(또는 CSP 가 없어도) 문서가 다른 파일 · 주소를 가리킬 자리가 없게.
 */
const PRINT_TAGS = new Set(['html', 'head', 'meta', 'title', 'style', 'body', 'h1', 'h2', 'h3', 'h4', 'p', 'table', 'tbody', 'thead', 'tr', 'th', 'td',
    'div', 'span', 'ul', 'ol', 'li', 'b', 'i', 'em', 'strong', 'hr', 'br', 'sub', 'sup', 'small', 'dl', 'dt', 'dd', 'details', 'summary', 'pre', 'code',
    'svg', 'g', 'line', 'circle', 'path', 'rect', 'text', 'polygon', 'polyline', 'ellipse', 'img']);
const BAD_ATTR = /(?:^|\s)(?:on[a-z]+|href|xlink:href|srcdoc|formaction|action|background|poster|ping|srcset)\s*=|javascript:|vbscript:|file:|https?:|ftp:|url\s*\(|@import|expression\s*\(/i;
export function sanitizeForPrint(html: string): string {
    const noStyle = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (all, css: string) => (/url\s*\(|@import|expression\s*\(|\\/i.test(css) ? '' : all));
    return noStyle.replace(/<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g, (all, close: string, name: string, attrs: string) => {
        const tag = name.toLowerCase();
        if (!PRINT_TAGS.has(tag)) { return '&lt;' + all.slice(1); }
        if (close) { return `</${tag}>`; }
        if (tag === 'meta' && !/^\s+(?:charset="utf-8"|http-equiv="Content-Security-Policy" content="[^"]*")\s*\/?$/i.test(attrs)) { return ''; }
        if (tag === 'img') {
            const src = /\ssrc="(data:image\/png;base64,[A-Za-z0-9+/]+=*)"/.exec(attrs);
            return src ? `<img src="${src[1]}">` : '';
        }
        if (tag !== 'meta' && BAD_ATTR.test(attrs)) { return `<${tag}>`; }
        return all;
    });
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
