/**
 * V9b-02 — 이름만으로 정하는 형식(순수 — 노드 · DOM 없이). 다리 · 껍데기(주 프로세스)의 마지막 문(openable.ts)과 화면의 표시가 같은 표를 쓴다.
 * 결정은 주 프로세스가 진짜 경로로 한다 — 화면은 이것으로 이름이 무엇인지 보이기만 한다.
 *
 * 문서 형식의 목록 · 진짜 마지막 확장자는 **호스트가 쥔 한 곳**(`src/records/openable.ts` — `person.sourceToOpen` · `sources` 의 `openable` 이 쓰는 것)을
 * 그대로 묶는다(D1 — 다리 · 껍데기 · 화면이 따로 쥔 목록을 없앰). 여기 남은 것은 열지 않는 형식의 이름(실행 파일 · 바로 가기 …)뿐이다.
 */
import { OPENABLE_EXT as HOST_OPENABLE_EXT, realExt as hostRealExt } from '../../../../src/records/openable';

export const OPENABLE_EXT: readonly string[] = HOST_OPENABLE_EXT;
const EXEC = new Set(['exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'dll', 'jar', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'reg', 'inf', 'msc', 'appx', 'msix', 'appref-ms', 'gadget', 'application', 'py', 'pyw', 'sh']);
const SHORTCUT = new Set(['lnk', 'url', 'website', 'scf', 'library-ms', 'searchconnector-ms', 'desktop']);
const ARCHIVE = new Set(['zip', '7z', 'rar', 'cab', 'iso', 'img', 'vhd', 'vhdx', 'tar', 'gz']);
const HTML = new Set(['html', 'htm', 'mht', 'mhtml', 'xhtml', 'svg', 'xml']);

export type OpenKind = 'document' | 'executable' | 'shortcut' | 'archive' | 'html' | 'other';
export interface OpenVerdict { ext: string; kind: OpenKind; openable: boolean; misleading: boolean; shownAs: string }

/** 진짜 마지막 확장자(작은 글자, 점 없이) — Windows 가 이름 끝의 점 · 빈칸을 떼는 것을 따라 한다 */
export function realExt(name: string): string { return hostRealExt(name); }

/** 이름만으로 — 화면에 보일 것(겹 확장자 `x.pdf.bat` 는 「실제 형식 .bat」 로) */
export function classifyName(name: string): OpenVerdict {
  const base = String(name).split(/[\\/]/).pop() ?? '';
  const ext = realExt(base);
  const kind: OpenKind = OPENABLE_EXT.includes(ext) ? 'document' : EXEC.has(ext) ? 'executable' : SHORTCUT.has(ext) ? 'shortcut' : ARCHIVE.has(ext) ? 'archive' : HTML.has(ext) ? 'html' : 'other';
  // 앞쪽에 문서 확장자처럼 보이는 마디가 있고 진짜 형식이 다르면 — 속이는 이름
  const trimmed = base.replace(/[. ]+$/u, '');
  const stem = ext ? trimmed.slice(0, trimmed.length - ext.length - 1) : trimmed;
  const inner = realExt(stem);
  const misleading = !!inner && inner !== ext && (OPENABLE_EXT.includes(inner) || HTML.has(inner));
  const KO: Record<OpenKind, string> = { document: '문서', executable: '실행 파일', shortcut: '바로 가기', archive: '압축 파일', html: '웹 문서', other: '모르는 형식' };
  const shownAs = `${ext ? `.${ext}` : '확장자 없음'} · ${KO[kind]}`;
  return { ext, kind, openable: kind === 'document', misleading, shownAs };
}

