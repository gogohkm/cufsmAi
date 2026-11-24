/**
 * vscode.Uri — file 과 그 밖의 scheme 을 다룬다. 경로는 VS Code 와 같이
 * '/' 로 적고(`/C:/a/b` 꼴 포함), fsPath 에서 OS 경로로 바꾼다.
 */
import * as nodePath from 'node:path';

const isWin = process.platform === 'win32';

function toPosixPath(fsPath: string): string {
  let p = fsPath.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(p)) { p = `/${p}`; }
  if (!p.startsWith('/')) { p = `/${p}`; }
  return p;
}

export class Uri {
  readonly scheme: string;
  readonly authority: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;

  protected constructor(scheme: string, authority: string, path: string, query: string, fragment: string) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  static file(fsPath: string): Uri {
    return new Uri('file', '', toPosixPath(nodePath.resolve(fsPath)), '', '');
  }

  static parse(value: string, _strict?: boolean): Uri {
    const m = /^([a-zA-Z][\w+.-]*):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!m) {
      // scheme 이 없으면 file 경로로 본다(VS Code 도 비슷하게 너그럽다).
      return Uri.file(value);
    }
    const scheme = m[1].toLowerCase();
    // Windows 드라이브 문자(`C:/…`)를 scheme 으로 오인하지 않는다.
    if (scheme.length === 1 && isWin) { return Uri.file(value); }
    return new Uri(scheme, percentDecode(m[2] ?? ''), percentDecode(m[3] || '/'),
      percentDecode(m[4] ?? ''), percentDecode(m[5] ?? ''));
  }

  static from(components: { scheme: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(components.scheme, components.authority ?? '', components.path ?? '/',
      components.query ?? '', components.fragment ?? '');
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const joined = nodePath.posix.join(base.path || '/', ...segments);
    return base.with({ path: joined });
  }

  static isUri(thing: unknown): thing is Uri {
    return thing instanceof Uri;
  }

  get fsPath(): string {
    if (this.scheme !== 'file') { return this.path; }
    let p = this.path;
    if (isWin) {
      if (/^\/[A-Za-z]:/.test(p)) { p = p.slice(1); }
      p = p.replace(/\//g, '\\');
    }
    if (this.authority && this.authority !== '') {
      return isWin ? `\\\\${this.authority}${p}` : `//${this.authority}${p}`;
    }
    return p;
  }

  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority,
      change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment);
  }

  /** VS Code `URI.toString()`(`_asFormatted`)과 같은 규칙 — 아래 `formatUri` */
  toString(skipEncoding = false): string {
    return formatUri(this, skipEncoding);
  }

  toJSON(): Record<string, unknown> {
    return { $mid: 1, scheme: this.scheme, authority: this.authority, path: this.path,
      query: this.query, fragment: this.fragment, fsPath: this.fsPath, external: this.toString() };
  }
}

// ── VS Code `src/vs/base/common/uri.ts` 의 인코딩을 옮긴 것 ─────────────────────────────
// 남기는 것은 RFC 3986 의 unreserved(`A-Z a-z 0-9 - . _ ~`)뿐이고, 경로의 `/`, authority 의 `[ ] :` 만 더 남긴다.
// `encodeURIComponent` 와 달리 `! ' ( ) *` 와 `:`(경로의 드라이브 문자도 `c%3A`)를 인코딩한다 — 설치 경로의
// `)` · `'` 가 HTML 속성 · 정규식에서 주소를 끊지 않는다. 드라이브 문자는 소문자로(http · https 는 빼고).

const ENCODE_TABLE: Record<number, string> = {
  0x3A: '%3A', 0x2F: '%2F', 0x3F: '%3F', 0x23: '%23', 0x5B: '%5B', 0x5D: '%5D', 0x40: '%40',
  0x21: '%21', 0x24: '%24', 0x26: '%26', 0x27: '%27', 0x28: '%28', 0x29: '%29', 0x2A: '%2A',
  0x2B: '%2B', 0x2C: '%2C', 0x3B: '%3B', 0x3D: '%3D', 0x20: '%20',
};

function encodeFast(s: string, isPath: boolean, isAuthority: boolean): string {
  let out: string | undefined;
  let nativeFrom = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const keep = (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39)
      || c === 0x2D || c === 0x2E || c === 0x5F || c === 0x7E
      || (isPath && c === 0x2F) || (isAuthority && (c === 0x5B || c === 0x5D || c === 0x3A));
    if (keep) {
      if (nativeFrom !== -1) { out += encodeURIComponent(s.substring(nativeFrom, i)); nativeFrom = -1; }
      if (out !== undefined) { out += s.charAt(i); }
      continue;
    }
    if (out === undefined) { out = s.substring(0, i); }
    const esc = ENCODE_TABLE[c];
    if (esc !== undefined) {
      if (nativeFrom !== -1) { out += encodeURIComponent(s.substring(nativeFrom, i)); nativeFrom = -1; }
      out += esc;
    } else if (nativeFrom === -1) {
      nativeFrom = i;
    }
  }
  if (nativeFrom !== -1) { out += encodeURIComponent(s.substring(nativeFrom)); }
  return out ?? s;
}

/** `toString(true)` — `#` · `?` 만 인코딩한다 */
function encodeMinimal(s: string): string {
  let out: string | undefined;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x23 || c === 0x3F) {
      if (out === undefined) { out = s.substring(0, i); }
      out += ENCODE_TABLE[c];
    } else if (out !== undefined) {
      out += s[i];
    }
  }
  return out ?? s;
}

/** 경로 하나를 `toString()` 과 같이 인코딩한다(`/` 는 남긴다) */
export function encodeUriPath(path: string): string { return encodeFast(path, true, false); }

export function formatUri(u: { scheme: string; authority: string; path: string; query: string; fragment: string }, skipEncoding: boolean): string {
  const enc = skipEncoding ? (s: string) => encodeMinimal(s) : encodeFast;
  let res = '';
  const { scheme, query, fragment } = u;
  let { authority, path } = u;
  if (scheme) { res += `${scheme}:`; }
  if (authority || scheme === 'file') { res += '//'; }
  if (authority) {
    let at = authority.indexOf('@');
    if (at !== -1) {
      const userinfo = authority.substring(0, at);
      authority = authority.substring(at + 1);
      at = userinfo.indexOf(':');
      res += at === -1 ? enc(userinfo, false, false)
        : `${enc(userinfo.substring(0, at), false, false)}:${enc(userinfo.substring(at + 1), false, false)}`;
      res += '@';
    }
    authority = authority.toLowerCase();
    const colon = authority.lastIndexOf(':');
    res += colon === -1 ? enc(authority, false, true) : enc(authority.substring(0, colon), false, true) + authority.substring(colon);
  }
  if (path) {
    const sch = scheme.toLowerCase();
    const lowerDrive = sch !== 'http' && sch !== 'https';
    if (path.length >= 3 && path.charCodeAt(0) === 0x2F && path.charCodeAt(2) === 0x3A) {
      const c = path.charCodeAt(1);
      if (c >= 0x41 && c <= 0x5A && lowerDrive) { path = `/${String.fromCharCode(c + 32)}:${path.substring(3)}`; }
    } else if (path.length >= 2 && path.charCodeAt(1) === 0x3A) {
      const c = path.charCodeAt(0);
      if (c >= 0x41 && c <= 0x5A && lowerDrive) { path = `${String.fromCharCode(c + 32)}:${path.substring(2)}`; }
    }
    res += enc(path, true, false);
  }
  if (query) { res += `?${enc(query, false, false)}`; }
  if (fragment) { res += `#${skipEncoding ? fragment : encodeFast(fragment, false, false)}`; }
  return res;
}

/** VS Code 의 `percentDecode` — 깨진 `%` 는 그대로 둔다(던지지 않는다) */
function decodeTolerant(s: string): string {
  try { return decodeURIComponent(s); } catch { return s.length > 3 ? s.substring(0, 3) + decodeTolerant(s.substring(3)) : s; }
}
export function percentDecode(s: string): string {
  return /(%[0-9A-Za-z][0-9A-Za-z])+/.test(s) ? s.replace(/(%[0-9A-Za-z][0-9A-Za-z])+/g, m => decodeTolerant(m)) : s;
}
