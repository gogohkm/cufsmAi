#!/usr/bin/env node
// S5 · Python 묶음 — 설치본의 <resources>/python/ 이 될 폴더를 desktop/installer/build/python-win-x64/ 에 만든다.
//
//   node desktop/installer/python.mjs            받기(캐시) → 풀기 → 휠 넣기 → ._pth → 덜어 내기 → 실행 확인 → 알림 파일
//   --no-trim                                    덜어 내지 않는다(크기 비교용)
//
// 받는 곳은 둘뿐이다: python.org(CPython embeddable 배포판)와 PyPI(files.pythonhosted.org 의 numpy · scipy 휠). uv 는 이 PC 에 없어서
// 쓰지 않았다. 받은 파일은 build/downloads/ 에 캐시. **주소와 sha256 은 이 파일의 PINS 에 고정돼 있다**(V5-14):
//  - 받은 파일 · 캐시의 파일 모두 PINS 의 sha256 과 맞춰 본다. 다르면 멈춘다(캐시를 고쳐 쓰지 않는다 — 지우고 다시 돌리라고 알린다).
//    받는 중에는 임시 이름(`.part`)에 쓰고, 맞으면 이름을 바꾼다. HTTP 상태가 200 이 아니면 멈춘다.
//  - 고정값의 출처: 휠 둘은 PyPI 가 공개한 sha256(파일 페이지 · JSON API 의 digests)과 같다. embeddable zip 은 python.org 에서 처음
//    받은 것의 sha256 이다 — 그때(2026-11-22) 그 안의 실행 파일 · DLL · .pyd 30 개가 모두 유효한 Authenticode 서명(PSF, vcruntime 은
//    Microsoft)이었다. 지금도 빌드마다 그 30 개 전부의 서명을 다시 확인한다.
//  1. Python: python-<판>-embed-amd64.zip(python.org) — sha256 고정 + 안의 모든 .exe · .dll · .pyd 의 서명.
//  2. 휠: 의존성은 numpy 하나(scipy → numpy) — 둘 다 주소 · sha256 고정. 휠은 zip 이라 그대로 site-packages 에 푼다(*.data 의 purelib · platlib 만).
//     휠 안의 DLL(OpenBLAS 등)은 서명이 없다 — 그쪽은 sha256 고정이 확인의 전부다.
//  3. `python313._pth` — 이 Python 의 sys.path 를 이 파일이 정한다(옮겨도 되는 상대 경로): 표준 라이브러리 zip, 자기 폴더,
//     `Lib\site-packages`, 그리고 엔진 `..\app-root\python`(._pth 가 있으면 스크립트 폴더를 sys.path 에 넣지 않는다 — server.py 가
//     `engine` · `design` … 을 불러올 수 있게). ._pth 가 있으면 PYTHONPATH · PYTHONHOME · 사용자 site-packages 를 보지 않는다 —
//     사용자 PC 의 Python 설정에 휘둘리지 않는다.
//  4. 덜어 내기: 패키지 자체 시험(tests) · C 헤더 · 정적 라이브러리. 목록과 크기를 STCFSD_PYTHON.json 에 남긴다.
//  5. 확인: 깨끗한 환경(PATH 에 Python 없음, PYTHON* 변수 없음)에서 묶은 python.exe 로 numpy · scipy 를 불러와 판 · sys.prefix 를 본다.
//  6. 알림: THIRD_PARTY_NOTICES.txt + licenses/(Python · numpy · scipy 의 라이선스 원문).
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const buildDir = path.join(here, 'build');
const downloads = path.join(buildDir, 'downloads');
export const pythonDir = path.join(buildDir, 'python-win-x64');

/** 고정한 판 — 저장소의 .venv 와 같다(2026-11-22: Python 3.13.14 · numpy 2.4.4 · scipy 1.17.1). 바꾸면 여기만 바꾼다 */
export const PINS = {
  python: '3.13.14',
  embed: {
    url: 'https://www.python.org/ftp/python/3.13.14/python-3.13.14-embed-amd64.zip',
    sha256: '90b4e5b9898b72d744650524bff92377c367f44bd5fbd09e3148656c080ad907',
  },
  packages: [
    { name: 'numpy', version: '2.4.4', license: 'BSD-3-Clause (+ 함께 묶인 OpenBLAS 등 — licenses/numpy 참고)',
      url: 'https://files.pythonhosted.org/packages/57/fb/48649b4971cde70d817cf97a2a2fdc0b4d8308569f1dd2f2611959d2e0cf/numpy-2.4.4-cp313-cp313-win_amd64.whl',
      sha256: '5c70f1cc1c4efbe316a572e2d8b9b9cc44e89b95f79ca3331553fbb63716e2bf' },
    { name: 'scipy', version: '1.17.1', license: 'BSD-3-Clause (+ 함께 묶인 OpenBLAS · libgfortran 등 — licenses/scipy 참고)',
      url: 'https://files.pythonhosted.org/packages/35/e5/d6d0e51fc888f692a35134336866341c08655d92614f492c6860dc45bb2c/scipy-1.17.1-cp313-cp313-win_amd64.whl',
      sha256: '37425bc9175607b0268f493d79a292c39f9d001a357bebb6b88fdfaff13f6448' },
  ],
};
const PTH = 'python313._pth';

/** 덜어 낼 것(site-packages 기준 glob) */
const TRIM = [
  ['numpy/**/tests', 'numpy 자체 시험'],
  ['scipy/**/tests', 'scipy 자체 시험'],
  ['numpy/_core/include', 'C 헤더(확장 모듈을 빌드할 때만)'],
  ['numpy/_core/lib', '정적 라이브러리 npymath(빌드할 때만)'],
  ['numpy/f2py/tests', 'f2py 시험'],
];

const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
const say = s => process.stdout.write(`${s}\n`);
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function duBytes(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) { return st.size; }
  let n = 0; for (const x of fs.readdirSync(p)) { n += duBytes(path.join(p, x)); } return n;
}
function countFiles(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) { return 1; }
  let n = 0; for (const x of fs.readdirSync(p)) { n += countFiles(path.join(p, x)); } return n;
}

function segRe(seg) { return new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`); }
export function compileGlob(glob) {
  const parts = glob.split('/').filter(Boolean).map(s => (s === '**' ? '**' : segRe(s)));
  const m = (p, i, j) => {
    if (i === parts.length) { return j === p.length; }
    if (parts[i] === '**') { for (let k = j; k <= p.length; k++) { if (m(p, i + 1, k)) { return true; } } return false; }
    return j < p.length && parts[i].test(p[j]) && m(p, i + 1, j + 1);
  };
  return rel => m(rel.split('/'), 0, 0);
}

/** 고정한 sha256 이 있어야만 받는다. 캐시 · 새로 받은 것 모두 맞춰 보고, 다르면 멈춘다(V5-14) */
export async function download(url, file, expectSha) {
  if (!/^[0-9a-f]{64}$/.test(String(expectSha))) { throw new Error(`고정한 sha256 이 없다: ${url}`); }
  if (fs.existsSync(file)) {
    const got = sha256(fs.readFileSync(file));
    if (got !== expectSha) { throw new Error(`캐시 파일의 sha256 이 고정값과 다르다 — 쓰지 않는다. 지우고 다시 돌려라: ${file}\n  ${got} ≠ ${expectSha}`); }
    return fs.readFileSync(file);
  }
  say(`  받기 ${url}`);
  const r = await fetch(url, { headers: { 'User-Agent': 'stcfsd-installer-build' } });
  if (r.status !== 200) { throw new Error(`받지 못함 ${url}: HTTP ${r.status}`); }
  const buf = Buffer.from(await r.arrayBuffer());
  const got = sha256(buf);
  if (got !== expectSha) { throw new Error(`받은 파일의 sha256 이 고정값과 다르다 — 버린다 ${url}\n  ${got} ≠ ${expectSha}`); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  fs.writeFileSync(part, buf);
  fs.renameSync(part, file);
  return buf;
}

/** Windows 10+ 의 tar(bsdtar)는 zip 을 푼다 */
function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  const r = spawnSync(tar, ['-xf', zip, '-C', dest], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) { throw new Error(`풀지 못함 ${zip}: ${r.stderr}`); }
}

/** 폴더 맨 위의 .exe · .dll · .pyd 모두의 Authenticode 서명 → [{name, status, subject}] */
function authenticodeAll(dir) {
  const ps = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -File | Where-Object { $_.Extension -in '.exe','.dll','.pyd' } | `
    + `ForEach-Object { $s = Get-AuthenticodeSignature -LiteralPath $_.FullName; [pscustomobject]@{name=$_.Name; status="$($s.Status)"; subject="$($s.SignerCertificate.Subject)"} } | ConvertTo-Json -Compress`;
  // PowerShell 7(pwsh)을 먼저 쓴다. Windows PowerShell 5 를 pwsh 아래에서 띄우면 PSModulePath 가 섞여 서명 모듈을 못 읽는다 — 그 변수를 뺀다.
  const env = { ...process.env };
  delete env.PSModulePath;
  for (const shell of ['pwsh', 'powershell']) {
    const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, env, maxBuffer: 16 * 1024 * 1024 });
    try { const j = JSON.parse(r.stdout); const list = Array.isArray(j) ? j : [j]; if (list.length && list[0].status) { return list; } } catch { /* 다음 */ }
  }
  return [];
}
const TRUSTED_SIGNERS = /CN=(Python Software Foundation|Microsoft Windows Software Compatibility Publisher|Microsoft Corporation),/;

function trimTree(root, rules) {
  const compiled = rules.map(([g, why]) => ({ g, why, fn: compileGlob(g) }));
  const removed = [];
  const visit = rel => {
    const abs = path.join(root, ...rel.split('/').filter(Boolean));
    let names; try { names = fs.readdirSync(abs); } catch { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      const a = path.join(abs, name);
      const hit = compiled.find(c => c.fn(r));
      if (hit) { removed.push({ path: r, bytes: duBytes(a), files: countFiles(a), why: hit.why }); fs.rmSync(a, { recursive: true, force: true }); continue; }
      if (fs.lstatSync(a).isDirectory()) { visit(r); }
    }
  };
  visit('');
  return removed;
}

export async function buildPython({ trim = true } = {}) {
  const t0 = Date.now();
  say(`▶ Python ${PINS.python} embeddable + ${PINS.packages.map(p => `${p.name} ${p.version}`).join(' · ')}`);
  // 1. Python
  const embedUrl = PINS.embed.url;
  const embedName = path.basename(new URL(embedUrl).pathname);
  const embedBuf = await download(embedUrl, path.join(downloads, embedName), PINS.embed.sha256);
  say(`  ${embedName} · sha256 고정값과 같음`);
  fs.rmSync(pythonDir, { recursive: true, force: true });
  unzip(path.join(downloads, embedName), pythonDir);
  const exe = path.join(pythonDir, 'python.exe');
  if (!fs.existsSync(exe) || !fs.existsSync(path.join(pythonDir, PTH))) { throw new Error(`${embedName} 의 모양이 다르다(python.exe · ${PTH} 없음)`); }
  const sigs = authenticodeAll(pythonDir);
  const badSig = sigs.filter(s => s.status !== 'Valid' || !TRUSTED_SIGNERS.test(`${s.subject},`));
  if (sigs.length < 10 || badSig.length || !sigs.some(s => s.name === 'python.exe') || !sigs.some(s => s.name === 'python313.dll')) {
    throw new Error(`Python 실행 파일 · DLL 서명 확인 실패(${sigs.length}개 중 ${badSig.length}개): ${JSON.stringify(badSig.slice(0, 5))}`);
  }
  const sig = sigs.find(s => s.name === 'python.exe');
  say(`  서명: .exe · .dll · .pyd ${sigs.length}개 모두 Valid (${[...new Set(sigs.map(s => s.subject.split(',')[0]))].join(' · ')})`);
  const pythonBytes = duBytes(pythonDir);

  // 2. 휠
  const sp = path.join(pythonDir, 'Lib', 'site-packages');
  fs.mkdirSync(sp, { recursive: true });
  const wheels = [];
  for (const p of PINS.packages) {
    const f = { filename: path.basename(new URL(p.url).pathname), url: p.url, digests: { sha256: p.sha256 } };
    const file = path.join(downloads, f.filename);
    f.size = (await download(f.url, file, f.digests.sha256)).length;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-wheel-'));
    unzip(file, tmp);
    for (const name of fs.readdirSync(tmp)) {
      const a = path.join(tmp, name);
      if (name.endsWith('.data')) {
        // *.data/purelib · platlib 은 site-packages 로, scripts · headers · data 는 넣지 않는다
        for (const sub of fs.readdirSync(a)) {
          if (sub === 'purelib' || sub === 'platlib') { fs.cpSync(path.join(a, sub), sp, { recursive: true }); }
        }
        continue;
      }
      fs.cpSync(a, path.join(sp, name), { recursive: true });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    wheels.push({ name: p.name, version: p.version, file: f.filename, url: f.url, sha256: f.digests.sha256, size: f.size, license: p.license });
    say(`  휠 ${f.filename} · sha256 고정값과 같음`);
  }
  // 휠 안의 빈 항목이 풀려 생긴 0 바이트 *.whl(V5 덤) — 쓸모없다
  for (const n of fs.readdirSync(sp)) { if (n.endsWith('.whl')) { fs.rmSync(path.join(sp, n), { force: true }); } }
  const packagesBytes = duBytes(sp);

  // 3. ._pth — 상대 경로라 폴더째 옮겨도 된다
  fs.writeFileSync(path.join(pythonDir, PTH), [
    'python313.zip', '.', 'Lib\\site-packages', '..\\app-root\\python',
    '# StCFSD 전용 Python — sys.path 는 이 파일이 정한다(PYTHONPATH · PYTHONHOME · 사용자 site-packages 를 보지 않는다).',
    '# ..\\app-root\\python = 해석 엔진(server.py 가 engine · design … 을 불러온다). 설치본의 resources 배치(desktop/installer/README.md).',
    '',
  ].join('\r\n'));

  // 4. 덜어 내기
  const removed = trim ? trimTree(sp, TRIM).map(r => ({ ...r, path: `Lib/site-packages/${r.path}` })) : [];
  const removedBytes = removed.reduce((n, r) => n + r.bytes, 0);
  for (const r of removed) { say(`  뺌 ${human(r.bytes).padStart(9)}  ${r.path} — ${r.why}`); }

  // 5. 실행 확인 — 깨끗한 환경: PATH 에 system32 만, PYTHON* 없음, 현재 폴더 = 임시
  const cleanEnv = { SystemRoot: process.env.SystemRoot, PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'), TEMP: os.tmpdir(), TMP: os.tmpdir() };
  const code = 'import sys, json, numpy, scipy, scipy.linalg, scipy.sparse.linalg, scipy.optimize\n'
    + 'print(json.dumps({"python": sys.version.split()[0], "prefix": sys.prefix, "exe": sys.executable, "path": sys.path, "numpy": numpy.__version__, "scipy": scipy.__version__, "flags_isolated": sys.flags.isolated, "user_site": __import__("site").ENABLE_USER_SITE}))';
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-pycheck-'));
  const r = spawnSync(exe, ['-B', '-c', code], { env: cleanEnv, cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (r.status !== 0) { throw new Error(`묶은 Python 으로 numpy · scipy 를 불러오지 못했다:\n${r.stderr.slice(-2000)}`); }
  const check = JSON.parse(r.stdout.trim().split('\n').pop());
  if (path.resolve(check.prefix) !== path.resolve(pythonDir)) { throw new Error(`sys.prefix 가 묶음이 아니다: ${check.prefix}`); }
  if (check.numpy !== PINS.packages[0].version || check.scipy !== PINS.packages[1].version || check.python !== PINS.python) {
    throw new Error(`판이 다르다: ${JSON.stringify(check)}`);
  }
  say(`  실행 확인: Python ${check.python} · numpy ${check.numpy} · scipy ${check.scipy} · sys.prefix = 묶음 · sys.path ${check.path.length}개(모두 묶음 안 + 엔진 자리)`);

  // 6. 알림 · 라이선스
  const lic = path.join(pythonDir, 'licenses');
  fs.mkdirSync(path.join(lic, 'python'), { recursive: true });
  fs.copyFileSync(path.join(pythonDir, 'LICENSE.txt'), path.join(lic, 'python', 'LICENSE.txt'));
  for (const w of wheels) {
    const di = fs.readdirSync(sp).find(n => n.toLowerCase().startsWith(`${w.name}-${w.version}`) && n.endsWith('.dist-info'));
    const dest = path.join(lic, w.name);
    fs.mkdirSync(dest, { recursive: true });
    const walk = (d, rel = '') => {
      for (const n of fs.readdirSync(d)) {
        const a = path.join(d, n);
        if (fs.statSync(a).isDirectory()) { walk(a, path.join(rel, n)); }
        else if (/licen[cs]e|copying|notice/i.test(path.join(rel, n))) { fs.mkdirSync(path.join(dest, rel), { recursive: true }); fs.copyFileSync(a, path.join(dest, rel, n)); }
      }
    };
    if (di) { walk(path.join(sp, di)); }
  }
  const notices = [
    'StCFSD — 함께 묶은 Python 과 패키지',
    '',
    `CPython ${PINS.python} (Windows x64 embeddable)`,
    `  출처: ${embedUrl}`,
    `  sha256: ${sha256(embedBuf)}`,
    '  라이선스: PSF License Version 2 (licenses/python/LICENSE.txt — 함께 묶인 OpenSSL · libffi · SQLite · zlib · bzip2 · xz 등의 고지 포함)',
    '',
    ...wheels.flatMap(w => [`${w.name} ${w.version}`, `  출처: ${w.url}`, `  sha256: ${w.sha256}`, `  라이선스: ${w.license}`, '']),
    `덜어 낸 것: ${removed.length ? removed.map(x => x.path).join(', ') : '없음'}`,
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(pythonDir, 'THIRD_PARTY_NOTICES.txt'), notices);

  const info = {
    schema: 'stcfsd-python-bundle/1', createdAt: new Date().toISOString(),
    python: { version: PINS.python, url: embedUrl, sha256: sha256(embedBuf), signature: sig, signedFiles: sigs.length, pinned: PINS.embed.sha256 },
    packages: wheels, pth: fs.readFileSync(path.join(pythonDir, PTH), 'utf8').split(/\r?\n/).filter(Boolean),
    sizes: { pythonBytes, packagesBytes, removedBytes, totalBytes: duBytes(pythonDir), files: countFiles(pythonDir) },
    removed, check,
  };
  fs.writeFileSync(path.join(pythonDir, 'STCFSD_PYTHON.json'), `${JSON.stringify(info, null, 2)}\n`);
  say(`  크기: Python ${human(pythonBytes)} + 패키지 ${human(packagesBytes)} − 뺀 것 ${human(removedBytes)} = ${human(info.sizes.totalBytes)} (${info.sizes.files}개 파일) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  say(`  → ${path.relative(path.resolve(here, '..', '..'), pythonDir)}/ (STCFSD_PYTHON.json · THIRD_PARTY_NOTICES.txt)`);
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await buildPython({ trim: !process.argv.includes('--no-trim') }); }
  catch (err) { process.stderr.write(`\nPython 묶음 실패: ${err.message}\n`); process.exit(1); }
}
