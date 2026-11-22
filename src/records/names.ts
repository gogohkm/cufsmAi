/**
 * 기록(R1-1) · 이름과 글의 규칙 — 설계 §4.1. 파일을 읽거나 쓰지 않는다.
 *
 * 이름(프로젝트 · 검토 대상 — AI 가 줄 수 있다)은 폴더 · 파일 이름이 된다. 그래서:
 *  - NFC 로 맞춘다(macOS 의 NFD 와 같은 이름이 같은 글자열이 되게). 비교 열쇠는 NFC + 소문자(Windows 는 대소문자를 가리지 않는다).
 *  - 구분자(`/` `\`) · 드라이브(`C:`) · `:`(대체 데이터 스트림) · Windows 금지 글자(`< > " | ? *`) · 제어 문자 ·
 *    글 방향 제어 문자(보이는 이름을 속인다) 거절.
 *  - 점으로 시작(숨김 — `.stcfsd` · `.claude` …) · 점 / 공백으로 끝(Windows 가 떼어 내 다른 이름이 된다) · `.` · `..` 거절.
 *  - 장치 이름(CON · PRN · AUX · NUL · COM0–9 · LPT0–9 · 위첨자 1–3 · CONIN$ · CONOUT$ — 확장자가 붙어도) 거절.
 *  - 길이: 글자 60 · UTF-8 바이트 180 까지(긴 경로 한계를 넘기지 않게).
 *  - 프로그램이 쓰는 이름(선언 파일 · 정해진 폴더)과 같은 이름 거절.
 * 마디 하나의 규칙(`segmentError`)은 패널의 `_projectPathError` 의 이름 규칙(점으로 시작 · 점 / 공백으로 끝 · `:`)과 같은 뜻이다 —
 * 호스트가 나중에 이것을 함께 쓸 수 있다.
 *
 * 글(AI 가 쓴 이유 · 제목 · 본문 …): 줄바꿈 · 탭 밖의 제어 문자와 글 방향 제어 문자를 지운다. 한도를 넘으면 **자르지 않고 거절**.
 */

export const NAME_MAX_CHARS = 60;
export const NAME_MAX_BYTES = 180;

// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/;
const BIDI = /[‎‏‪-‮⁦-⁩؜]/;
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/** 프로그램이 정한 이름(상수) — 이름으로 쓸 수 없다 */
export const RESERVED_NAMES = ['stcfsd-project.json', '01_원자료', '02_검토대상', '03_계산서', '04_발행본'];

export type NameResult = { ok: true; name: string; key: string } | { ok: false; error: string };

/** 경로 마디 하나의 규칙(이름 · 상대경로의 마디). 문제 없으면 null */
export function segmentError(seg: string): string | null {
    if (seg === '' ) { return 'empty name'; }
    if (seg === '.' || seg === '..') { return `'${seg}' is not a name`; }
    if (FORBIDDEN_CHARS.test(seg)) { return 'a name may not contain < > : " / \\ | ? * or control characters'; }
    if (BIDI.test(seg)) { return 'a name may not contain text-direction control characters'; }
    if (seg.startsWith('.')) { return "a name may not start with '.' (hidden)"; }
    if (/[. ]$/.test(seg)) { return "a name may not end with '.' or a space"; }
    if (/^\s/.test(seg)) { return 'a name may not start with a space'; }
    const stem = seg.split('.')[0].trim();
    if (DEVICE.test(stem)) { return `'${stem}' is a device name`; }
    return null;
}

/** 프로젝트 · 검토 대상의 이름 */
export function checkName(raw: unknown): NameResult {
    if (typeof raw !== 'string') { return { ok: false, error: 'a name must be text' }; }
    const name = raw.normalize('NFC');
    if (name.length === 0) { return { ok: false, error: 'empty name' }; }
    if ([...name].length > NAME_MAX_CHARS) { return { ok: false, error: `a name may have at most ${NAME_MAX_CHARS} characters` }; }
    if (Buffer.byteLength(name, 'utf8') > NAME_MAX_BYTES) { return { ok: false, error: `a name may have at most ${NAME_MAX_BYTES} bytes` }; }
    const seg = segmentError(name);
    if (seg) { return { ok: false, error: seg }; }
    const key = nameKey(name);
    if (RESERVED_NAMES.some((r) => nameKey(r) === key)) { return { ok: false, error: `'${name}' is used by the program` }; }
    return { ok: true, name, key };
}

/** 비교 열쇠 — NFC + 소문자 */
export function nameKey(name: string): string { return name.normalize('NFC').toLowerCase(); }

export type TextResult = { ok: true; text: string } | { ok: false; error: string };

/** AI 가 쓴 글: 제어 문자 지움(줄바꿈 · 탭은 남김), 한도를 넘으면 거절 */
export function cleanText(raw: unknown, max: number, opts: { optional?: boolean; field?: string } = {}): TextResult {
    const field = opts.field || 'text';
    if (raw === undefined || raw === null) {
        return opts.optional ? { ok: true, text: '' } : { ok: false, error: `${field} is required` };
    }
    if (typeof raw !== 'string') { return { ok: false, error: `${field} must be text` }; }
    // eslint-disable-next-line no-control-regex
    const text = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(new RegExp(BIDI.source, 'g'), '');
    if ([...text].length > max) { return { ok: false, error: `${field} is longer than ${max} characters (not truncated — shorten it)` }; }
    if (!opts.optional && text.trim() === '') { return { ok: false, error: `${field} is empty` }; }
    return { ok: true, text };
}

/** 머리(HTTP)로 온 한 줄 글 — 제어 문자 지움, 길이 한도(머리는 잘라도 된다: 원문이 아니다) */
export function cleanHeaderText(raw: unknown, max: number): string | null {
    if (typeof raw !== 'string') { return null; }
    // eslint-disable-next-line no-control-regex
    const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(new RegExp(BIDI.source, 'g'), '').trim();
    return t ? [...t].slice(0, max).join('') : null;
}

export const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
