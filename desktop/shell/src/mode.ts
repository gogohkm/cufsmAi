/**
 * 실행 모드 — 시험 · 개발용 길을 설치본에서 닫는다(V5-13), 시작 전 사용자 폴더 점검(V5-11), 물음을 알리는 방법(V5-16c).
 *
 * 설치본(app.isPackaged)은 시험 · 개발 길을 따르지 않는다: `STCFSD_SHELL_TEST`(창을 숨기고 주 프로세스 eval 통로를 여는 것),
 * `STCFSD_PYTHON` · `STCFSD_CLAUDE_CONFIG` · `STCFSD_DOCUMENTS`(덮어쓰기). 예외는 **확인용 복사본** 하나다 —
 * `<resources>/stcfsd-verification.json` 이 있고 그것이 **이 빌드의 표시**일 때(`verificationMarkerValid` — 주 번들의 sha256 을 담은 정해진 꼴). 그 파일은 배포물(설치 파일 · win-unpacked)에 없다: 포장본 시험
 * (`desktop/installer/test/packaged.mjs`)이 풀린 폴더를 임시 자리로 복사한 뒤 그 파일 하나만 더하고, 나머지 모든 파일이 설치 파일
 * 안의 것과 바이트까지 같은지(sha256) 맞춰 본 다음 띄운다. 시험하는 것 = 배포하는 것 + 그 표시 파일.
 * 같은 사용자 권한의 프로그램은 그 파일을 만들 수 있지만, 그러면 설치 폴더의 main.js 도 바꿀 수 있다 — 더 약해지지 않는다(V5-13).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const VERIFICATION_MARKER = 'stcfsd-verification.json';
export const VERIFICATION_SCHEMA = 'stcfsd-verification/1';
/** 표시 파일에 둘 수 있는 키 — 이 밖의 키가 하나라도 있으면(모델 파일 · 다른 JSON) 표시가 아니다 */
const MARKER_KEYS = new Set(['schema', 'mainBundleSha256', 'note', 'createdAt']);

/**
 * 확인용 표시 파일이 **이 빌드의** 표시인가(V5-13 후속). 표시는 스스로를 지킨다:
 *  - 정확히 `{schema: "stcfsd-verification/1", mainBundleSha256: <이 프로그램이 지금 돌리는 main.js 의 sha256>}`(+ `note` · `createdAt`)이어야 한다.
 *  - 다른 키가 하나라도 있으면 아니다 — StCFSD 모델 파일(`save_project` 가 쓰는 것은 모델 키뿐 — `node` · `elem` …)은 `schema` 도
 *    `mainBundleSha256` 도 가질 수 없고, 가져도 다른 키 때문에 거절된다. 64 KiB 보다 크면 읽지 않는다.
 *  - sha256 이 지금 실행 중인 주 번들과 다르면 아니다 — 다른 빌드에서 가져온 표시 · 옛 표시는 효과가 없다.
 * 무엇이 틀려도 조용히 「아니다」(설치본은 보통 실행으로 돈다).
 */
export function verificationMarkerValid(markerFile: string, mainBundleFile: string): boolean {
  try {
    const st = fs.statSync(markerFile);
    if (!st.isFile() || st.size > 64 * 1024) { return false; }
    const j = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) { return false; }
    if (Object.keys(j).some(k => !MARKER_KEYS.has(k))) { return false; }
    if (j.schema !== VERIFICATION_SCHEMA || typeof j.mainBundleSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(j.mainBundleSha256)) { return false; }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(mainBundleFile)).digest('hex');
    return actual === j.mainBundleSha256;
  } catch { return false; }
}

export interface RunModeInput {
  packaged: boolean;
  env: NodeJS.ProcessEnv;
  /** `<resources>/stcfsd-verification.json` 이 있는가 */
  verificationMarker: boolean;
}

export interface RunMode {
  /** 시험 모드(창을 보이지 않음 · 가짜 대화상자 · IPC 제어 통로) */
  test: boolean;
  /** 개발 덮어쓰기 변수를 따르는가 */
  devOverrides: boolean;
  /** 설치본의 확인용 복사본인가 */
  verification: boolean;
}

export function runMode(i: RunModeInput): RunMode {
  const verification = i.packaged && i.verificationMarker;
  const allowed = !i.packaged || verification;
  return { test: allowed && i.env.STCFSD_SHELL_TEST === '1', devOverrides: allowed, verification };
}

/** 개발 덮어쓰기 변수를 뺀 환경(설치본) */
export const DEV_OVERRIDE_VARS = ['STCFSD_SHELL_TEST', 'STCFSD_PYTHON', 'STCFSD_CLAUDE_CONFIG', 'STCFSD_DOCUMENTS', 'STCFSD_REPO_ROOT'];
export function effectiveEnv(env: NodeJS.ProcessEnv, mode: RunMode): NodeJS.ProcessEnv {
  if (mode.devOverrides) { return env; }
  const out = { ...env };
  for (const k of DEV_OVERRIDE_VARS) { delete out[k]; }
  return out;
}

/** 사용자 폴더를 만들고 쓸 수 있는가. 안 되면 까닭(사람이 읽는 글), 되면 undefined */
export function userDataProblem(dir: string): string | undefined {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.statSync(dir).isDirectory()) { return '폴더가 아니라 파일이 있습니다'; }
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe, { force: true });
    return undefined;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const why: Record<string, string> = {
      EACCES: '쓰기 권한이 없습니다', EPERM: '쓰기 권한이 없습니다', EEXIST: '같은 이름의 파일이 있습니다', ENOTDIR: '경로 중간에 폴더가 아닌 파일이 있습니다',
      EROFS: '읽기 전용 드라이브입니다', ENOSPC: '디스크 공간이 없습니다', ENOENT: '경로를 만들 수 없습니다',
    };
    return `${why[e.code ?? ''] ?? '쓸 수 없습니다'} (${e.code ?? 'error'}: ${e.message})`;
  }
}

/**
 * 호스트가 물음을 냈을 때 창을 어떻게 알리나 — 시험 모드든 아니든 같은 규칙이다(창을 보이거나 앞으로 꺼내지 않는다,
 * 포커스를 가져가지 않는다, 작업 표시줄만 깜빡인다). 시험 모드는 깜빡임만 실제로 하지 않는다.
 */
export function questionSignal(s: { focused: boolean; test: boolean }): { count: boolean; flash: boolean; show: false; focus: false } {
  return { count: !s.focused, flash: !s.focused && !s.test, show: false, focus: false };
}
