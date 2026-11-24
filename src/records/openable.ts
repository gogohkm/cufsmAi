/**
 * 원자료를 OS 의 문서 보기(ShellExecute · shell.openPath)로 열어도 되는 형식 — **호스트가 쥔 한 곳**(V9b, 독립 프로그램의 「열기」).
 * 독립 프로그램은 이 목록과 `person.sourceToOpen` 의 판단을 쓰고, 주 프로세스에서는 진짜 경로의 둘째 확인만 한다.
 *
 *  - 형식은 **진짜 마지막 확장자**로만(Windows 가 무시하는 끝의 점 · 빈칸을 떼고 — `a.bat.` · `a.bat ` 도 `.bat`). 이름의 앞쪽(`.pdf.bat`)은 보지 않는다.
 *  - 문서 형식만: pdf · 그림(png jpg jpeg gif bmp tif tiff webp) · CAD(dwg dxf) · 오피스 문서(doc docx xls xlsx ppt pptx odt ods odp rtf) · txt · csv.
 *    실행 파일 · 바로 가기 · 스크립트 · 압축 · html · 매크로를 담는 오피스 형식(docm xlsm pptm …)은 넣지 않는다 — 목록에 없으면 열지 않는다.
 * 순수(파일을 읽지 않는다).
 */
export const OPENABLE_EXT: readonly string[] = Object.freeze(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'dwg', 'dxf',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'csv']);

/** 진짜 마지막 확장자(작은 글자, 점 없이) — 이름 끝의 점 · 빈칸을 뗀다 */
export function realExt(name: string): string {
    const n = (String(name).split(/[\\/]/).pop() ?? '').replace(/[. ]+$/u, '');
    const i = n.lastIndexOf('.');
    return i > 0 ? n.slice(i + 1).toLowerCase() : '';
}

/** 이 이름(의 진짜 마지막 확장자)이 문서 보기로 열어도 되는 형식인가 */
export function isOpenableName(name: string): boolean { return OPENABLE_EXT.includes(realExt(name)); }
