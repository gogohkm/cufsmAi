/**
 * V9b-02 — 이 프로그램이 OS 에 「열어라」(ShellExecute · shell.openPath)를 부탁해도 되는 파일인가. 실행될 수 있는 것은 절대 열지 않는다.
 *
 *  - 형식은 **진짜 마지막 확장자**로만 정한다(Windows 가 무시하는 끝의 점 · 빈칸을 떼고 — `a.bat.` · `a.bat ` 도 `.bat`). 이름의 앞쪽(`.pdf.bat`)은 보지 않는다.
 *  - 허용 목록(문서 형식만): pdf · 그림(png jpg jpeg gif bmp tif tiff webp) · CAD(dwg dxf) · 오피스 문서(doc docx xls xlsx ppt pptx odt ods odp rtf) · txt · csv.
 *    매크로를 담는 오피스 형식(docm xlsm pptm …) · 실행 · 바로 가기(lnk url) · 스크립트 · 압축 · html 은 넣지 않는다 — 목록에 없으면 열지 않는다.
 *  - 열지 않는 파일은 「폴더에서 보기」(탐색기에서 그 파일을 고른 채 — 아무것도 실행하지 않는다).
 *  - 이 판단은 주 프로세스(다리의 플랫폼 · 껍데기)에서, 그 파일의 진짜 경로(realpath)로 한다. 화면은 이름을 보이기만 한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { classifyName, type OpenVerdict } from './openableName';
export { OPENABLE_EXT, classifyName, realExt, type OpenKind, type OpenVerdict } from './openableName';

/**
 * 주 프로세스의 마지막 문 — 진짜 경로(모든 마디의 링크 · junction 을 푼 것)의 이름으로 다시 판단한다. 읽을 수 없으면 열지 않는다.
 * `root` 를 주면 진짜 경로가 그 진짜 경로 안이어야 한다
 */
export function vetOpen(abs: string, root?: string): { ok: boolean; real: string | null; verdict: OpenVerdict | null; why?: string } {
  let real: string;
  try { real = fs.realpathSync.native(abs); } catch { return { ok: false, real: null, verdict: null, why: '파일을 읽을 수 없다' }; }
  try { if (!fs.statSync(real).isFile()) { return { ok: false, real, verdict: null, why: '파일이 아니다' }; } } catch { return { ok: false, real, verdict: null, why: '파일을 읽을 수 없다' }; }
  if (root) {
    let rr: string;
    try { rr = fs.realpathSync.native(root); } catch { return { ok: false, real, verdict: null, why: '원자료 폴더를 읽을 수 없다' }; }
    if (!real.toLowerCase().startsWith(rr.toLowerCase() + path.sep)) { return { ok: false, real, verdict: null, why: '진짜 경로가 원자료 폴더 밖이다' }; }
  }
  const verdict = classifyName(real);
  return verdict.openable ? { ok: true, real, verdict } : { ok: false, real, verdict, why: `열지 않는 형식(${verdict.shownAs})` };
}

/** 경로의 모든 마디(root 아래)에 링크 · junction 이 없는가 — 마디마다 lstat */
export function noLinksBelow(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return false; }
  let cur = root;
  try { if (fs.lstatSync(root).isSymbolicLink()) { return false; } } catch { return false; }
  for (const seg of rel.split(path.sep)) {
    cur = path.join(cur, seg);
    try { if (fs.lstatSync(cur).isSymbolicLink()) { return false; } } catch { return false; }
  }
  return true;
}
