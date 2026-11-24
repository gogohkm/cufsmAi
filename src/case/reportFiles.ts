/**
 * K3-5 — 프로그램이 스스로(AI 의 generate_report) 쓰는 보고서 파일의 규칙. 보안 검증에서 나온 파일 규율과 같다:
 *  - 쓰는 자리는 프로그램이 정한다: 열린 .csd 의 폴더, 열린 파일이 없으면 임시 폴더의 stcfsd-reports. AI 는 경로를 주지 않는다.
 *  - 이름은 검토 대상(.csd)의 이름에서 — 구분자 · 드라이브 · 금지 글자 · 제어 · 글 방향 제어 글자를 지우고, 앞의 점(숨김) ·
 *    끝의 점 / 공백을 떼고, 장치 이름(CON · NUL · COM1 …)은 앞에 「_」, 60 글자까지.
 *  - 새 파일이거나, **이 프로그램이 쓴 보고서 파일**만 덮어쓴다. 그것은 이름이 아니라 파일 안의 표지로 안다:
 *    HTML 은 첫 줄의 `<!-- stcfsd-report/1 -->`, PDF 는 끝의 `%stcfsd-report/1`(PDF 주석 — 읽는 프로그램은 무시한다).
 *    표지가 없는 같은 이름의 파일이 있으면 덮지 않고 다음 이름(…-2, -3 …)으로.
 *  - 링크를 따라가지 않는다: 대상이 심볼릭 링크 · 접합점이거나 보통 파일이 아니면 그 이름을 쓰지 않는다. 폴더는 진짜 경로(realpath)로.
 *  - 같은 폴더의 예측할 수 없는 임시 이름(wx — 있으면 실패)에 쓰고 rename. 실패하면 임시 파일을 지운다.
 * VS Code 를 쓰지 않는다(독립 프로그램의 호스트도 같은 코드).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
// 이름 마디의 규칙 하나(기록 갈래 · save_project 와 같은 것)
import { segmentError } from '../records/names';

export const HTML_MARKER = '<!-- stcfsd-report/1 -->';
export const PDF_MARKER = '\n%stcfsd-report/1\n';

/** 검토 대상 이름 → 파일 이름 앞부분(규칙은 머리말). 비면 'stcfsd' */
export function safeBaseName(raw: unknown): string {
    let s = String(raw ?? '');
    // V7-14: 짝 없는 서로게이트(파일 이름이 될 수 없다)는 '_'
    s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '_').normalize('NFC');
    s = s.replace(/[‎‏‪-‮⁦-⁩؜]/g, '')     // 글 방향 제어
        // V7-14: 보이지 않는 글자(형식 글자 — 폭 없는 공백 · 결합 막기 …)와 한글 채움 글자는 지운다(보기에 같은 두 이름이 생기지 않게)
        .replace(/[\p{Cf}\u115f\u1160\u3164\uffa0]/gu, '')
        // 경로 구분자처럼 보이는 글자(전각 · 나눗셈 · 분수 빗금, 전각 역빗금)도 구분자처럼 '_'
        .replace(/[\uff0f\u2215\u2044\uff3c\u29f5\u2571\u2572]/g, '_')
        .replace(/\p{Zs}/gu, ' ')                                             // 여러 공백 글자 → 보통 공백(아래에서 모으고 끝을 뗀다)
        .replace(/[<>:"/\\|?*]/g, '_');                                     // 구분자 · 드라이브 · 금지 글자
    s = [...s].map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? '_' : ch)).join('')   // 제어 문자
        .replace(/\s+/g, ' ').trim();
    s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');                     // 숨김 · 끝의 점 / 공백
    // 60 글자(코드 포인트 — 서로게이트 짝을 가르지 않는다)
    if ([...s].length > 60) { s = [...s].slice(0, 60).join('').replace(/[.\s]+$/, ''); }
    if (!s) { s = 'stcfsd'; }
    // 장치 이름(CON · NUL · COM1 … — 확장자가 붙어도)은 앞에 '_' — 판정은 src/records/names.ts segmentError 하나
    if (/device name/.test(segmentError(s) || '')) { s = '_' + s; }
    return segmentError(s) ? 'stcfsd' : s;
}

/** 보고서를 둘 폴더 — 열린 .csd 의 폴더(진짜 경로), 없거나 쓸 수 없으면 임시 폴더의 stcfsd-reports */
export function reportDir(casePath: string | null, folder?: string): { dir: string; where: 'case_folder' | 'temp' | 'folder' } {
    // 호스트 안의 호출자가 정한 폴더(기록 갈래의 03_계산서/ 등 — AI 는 줄 수 없다): 보통 폴더여야 한다, 링크 · 접합점 거절
    if (folder) {
        const abs = path.resolve(folder);
        const st = fs.lstatSync(abs);
        if (st.isSymbolicLink() || !st.isDirectory()) { throw new Error('report folder is not a plain folder: ' + abs); }
        return { dir: fs.realpathSync.native(abs), where: 'folder' };
    }
    if (casePath) {
        try {
            const real = fs.realpathSync.native(path.dirname(path.resolve(casePath)));
            if (fs.statSync(real).isDirectory()) { return { dir: real, where: 'case_folder' }; }
        } catch { /* 아래로 */ }
    }
    const tmp = path.join(os.tmpdir(), 'stcfsd-reports');
    try { fs.mkdirSync(tmp, { recursive: true }); } catch { /* 아래에서 확인 */ }
    const st = fs.lstatSync(tmp);
    if (st.isSymbolicLink() || !st.isDirectory()) { throw new Error(`report folder is not a plain folder: ${tmp}`); }
    return { dir: fs.realpathSync.native(tmp), where: 'temp' };
}

/** 이 프로그램이 쓴 보고서 파일인가(표지로) */
export function isOwnReport(file: string, kind: 'html' | 'pdf'): boolean {
    let fd: number | null = null;
    try {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.isSymbolicLink()) { return false; }
        fd = fs.openSync(file, 'r');
        const n = Math.min(256, st.size);
        const buf = Buffer.alloc(n);
        fs.readSync(fd, buf, 0, n, kind === 'html' ? 0 : st.size - n);
        const txt = buf.toString('latin1');
        return kind === 'html' ? Buffer.from(txt, 'latin1').toString('utf8').startsWith(HTML_MARKER) : txt.includes(PDF_MARKER.trim());
    } catch { return false; } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* */ } } }
}

/** 쓸 이름 — 비었거나 우리 표지가 있는 보통 파일이면 그 이름, 아니면 다음 번호. 링크면 건너뛴다. */
export function pickTarget(dir: string, stem: string, ext: 'html' | 'pdf'): string {
    for (let i = 1; i < 100; i++) {
        const name = `${stem}${i === 1 ? '' : '-' + i}.${ext}`;
        if (segmentError(name)) { throw new Error('report name refused: ' + segmentError(name)); }
        const file = path.join(dir, name);
        if (path.dirname(file) !== dir) { throw new Error('report name left the folder'); }
        let st: fs.Stats;
        try { st = fs.lstatSync(file); } catch { return file; }          // 없다 — 새 파일
        if (st.isSymbolicLink() || !st.isFile()) { continue; }         // 링크 · 폴더 · 장치 — 쓰지 않는다
        if (isOwnReport(file, ext)) { return file; }                   // 우리가 쓴 보고서 — 덮어쓴다
    }
    throw new Error(`no free report name for ${stem} in ${dir}`);
}

/** 같은 폴더의 임시 이름(wx)에 쓴 뒤 rename — 대상이 그 사이 링크가 되었으면 쓰지 않는다 */
export function writeVia(target: string, write: (tmp: string) => Promise<void> | void): Promise<void> {
    const dir = path.dirname(target);
    const tmp = path.join(dir, `.stcfsd-${randomBytes(8).toString('hex')}.tmp`);
    fs.writeFileSync(tmp, '', { flag: 'wx' });
    const done = async () => {
        await write(tmp);
        let st: fs.Stats | null = null;
        try { st = fs.lstatSync(target); } catch { /* 없음 */ }
        if (st && (st.isSymbolicLink() || !st.isFile())) { throw new Error(`report target became a link: ${target}`); }
        fs.renameSync(tmp, target);
    };
    return done().catch((e) => { try { fs.unlinkSync(tmp); } catch { /* */ } throw e; });
}
