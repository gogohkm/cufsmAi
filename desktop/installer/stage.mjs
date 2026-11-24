#!/usr/bin/env node
// S5 · 묶음 준비 — 설치본에 들어갈 파일을 저장소에서 골라 desktop/installer/build/stage/ 로 모은다.
//
//   node desktop/installer/stage.mjs             실을 것을 **모두 먼저 다시 빌드한 뒤**(낡은 빌드를 싣지 않게) 모은다
//   --no-build                                    다시 빌드하지 않는다(이미 방금 빌드했을 때 — 시험용)
//
// 다시 빌드하는 것(저장소 루트에서, 쓰는 곳은 build/ · desktop/*/dist 뿐 — 저장소의 out/ · media/ 는 건드리지 않는다):
//  - 확장 호스트: `npx tsc -p ./ --outDir build/out-fresh --sourceMap false` — **빈 폴더에** 새로(tsc 는 옛 출력을 지우지 않아
//    저장소의 out/ 에는 지금 소스에 없는 파일이 남아 있을 수 있다).
//  - MCP 서버 · 3D 뷰어 번들: 루트의 webpack 설정 그대로(`webpack.mcp.config.js` · `webpack.config.js`, 고치지 않는다)를
//    `--output-path build/media-fresh` 로 — 지금의 src/ 에서. 소스맵은 이 폴더에만(라이선스 목록을 여기서 뽑는다), 싣지 않는다.
//  - 호스트 · 다리(`desktop/host/build.mjs`), 껍데기(`desktop/shell/build.mjs`), 새 검토 화면(`desktop/ui/build.mjs`).
//
// 만드는 것(설치본의 <resources>/ 아래 모양 그대로 — README 의 그림):
//   stage/app/        → resources/app/       package.json(만든 것) · dist/main.js · dist/preload.js · host/index.js · host/frame/* ·
//                                            ui/(새 검토 화면 — `--ui` 일 때만 연다) · uninstall/disconnect.js(제거 때 Claude 등록 지우기)
//   stage/app-root/   → resources/app-root/  확장 호스트가 읽는 것: package.json(저장소 주소 등 뺌) · out/ · python/(소스만) · webview/ ·
//                                            media/ · LICENSE · THIRD_PARTY_NOTICES.txt
//   stage/manifest.json                      묶은 파일 · 크기 · sha256 · 빌드 출처(git HEAD · 커밋 안 된 변경) · 묶인 npm 패키지
// 넣지 않는 것: node_modules · docs · Example · test · .venv · src(TypeScript 원본) · *.map · __pycache__ · *.pyc · 시험 파일.
// 실은 .js 끝의 `//# sourceMappingURL=` 은 뺀다(그 .map 을 싣지 않는다 — V5-17).
// Python 은 여기서 모으지 않는다 — python.mjs 가 build/python-win-x64/ 에 만들고 electron-builder 가 resources/python/ 으로 가져간다.
//
// 제3자 고지(V5-07): 실은 번들 안에 실제로 든 npm 패키지를 **번들의 소스맵에서** 뽑는다(손으로 적은 목록이 아니다) — 각 패키지의
// 이름 · 판 · 라이선스 전문(+ NOTICE 가 있으면 그것도)을 app-root/THIRD_PARTY_NOTICES.txt 에. 라이선스 원문이 없는 패키지가 하나라도
// 있으면 멈춘다. 번들이 아닌 out/ 은 Node 내장 모듈과 `vscode`(호스트의 대체 모듈) 말고는 require 하지 않는지 본다.
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const buildDir = path.join(here, 'build');
export const stageDir = path.join(buildDir, 'stage');
/** 확장 호스트를 새로 컴파일하는 빈 폴더 — app-root/out 이 된다 */
const freshOut = path.join(buildDir, 'out-fresh');
/** MCP 서버 · 3D 뷰어 번들을 새로 만드는 빈 폴더 — app-root/media 의 .js 가 된다 */
const freshMedia = path.join(buildDir, 'media-fresh');
const say = s => process.stdout.write(`${s}\n`);
const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** 확장 호스트 폴더(app-root)에 저장소에서 그대로 넣는 것: [저장소 기준 폴더 · 파일, 빼는 규칙] */
const APP_ROOT = [
  ['LICENSE'],
  ['python', rel => /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) || /\.pyc$/.test(rel) || /(^|\/)test_[^/]*\.py$|_test\.py$/.test(rel)],
  ['webview', rel => rel.endsWith('.map')],
];
/** 배포용 package.json 에서 빼는 것(V5-17 — 소유자의 저장소 주소 · 개발 스크립트) */
const PKG_DROP = ['repository', 'bugs', 'homepage', 'scripts', 'devDependencies'];
/** 있어야만 하는 것(빠지면 설치본이 뜨지 않는다) */
const REQUIRED = [
  'app/package.json', 'app/dist/main.js', 'app/dist/preload.js', 'app/host/index.js', 'app/host/frame/index.html', 'app/host/frame/frame.js',
  'app/ui/index.html', 'app/ui/dist/main.js', 'app/uninstall/disconnect.js',
  'app-root/package.json', 'app-root/out/extension.js', 'app-root/out/webview/StcfsdPanel.js', 'app-root/out/mcp/bridge.js',
  'app-root/out/mcp/portFile.js', 'app-root/out/mcp/claudeDesktop.js', 'app-root/python/server.py', 'app-root/python/engine/fsm_solver.py',
  'app-root/webview/js/app.js', 'app-root/webview/css/theme.css', 'app-root/media/mcp-server.js', 'app-root/media/viewer3d.js',
  'app-root/THIRD_PARTY_NOTICES.txt', 'app-root/LICENSE',
];

function run(cmd, args, what) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf8', shell: process.platform === 'win32' && cmd === 'npx', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { throw new Error(`${what} 실패(${cmd} ${args.join(' ')}):\n${(r.stdout + r.stderr).slice(-3000)}`); }
  say(`  빌드 ${what} — ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

function copyTree(src, dest, skip, rel = '') {
  const st = fs.statSync(src);
  if (st.isFile()) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); return; }
  for (const name of fs.readdirSync(src)) {
    const r = rel ? `${rel}/${name}` : name;
    if (skip && skip(r)) { continue; }
    copyTree(path.join(src, name), path.join(dest, name), skip, r);
  }
}

function listFiles(root, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(path.join(root, r)).isDirectory()) { out.push(...listFiles(root, r)); } else { out.push(r); }
  }
  return out;
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  // 끝의 줄바꿈만 뗀다 — 앞을 자르면 porcelain 의 첫 줄(` M desktop/…`)에서 경로의 첫 글자가 사라진다
  return r.status === 0 ? r.stdout.replace(/\s+$/, '') : '';
}

// ── 제3자 고지 ────────────────────────────────────────────────────────
/**
 * 소스맵의 sources → 묶인 npm 패키지 폴더. webpack 은 `webpack://<이름>/./node_modules/…`(프로젝트 뿌리 기준),
 * esbuild 는 맵 파일 기준 상대 경로다. 마지막 `node_modules/<이름>`(또는 `@범위/이름`)까지가 패키지 폴더다.
 */
export function packagesInMap(mapFile, projectRoot) {
  const m = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const dirs = new Map();
  for (const s of m.sources ?? []) {
    const abs = s.startsWith('webpack://') ? path.resolve(projectRoot, s.replace(/^webpack:\/\/[^/]*\//, '')) : path.resolve(path.dirname(mapFile), s);
    const norm = abs.split(path.sep).join('/');
    const i = norm.lastIndexOf('/node_modules/');
    if (i < 0) { continue; }
    const rest = norm.slice(i + '/node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    const dir = `${norm.slice(0, i)}/node_modules/${name}`.split('/').join(path.sep);
    dirs.set(dir, name);
  }
  return dirs;
}

const LICENSE_FILE = /^(licen[cs]e|copying|unlicense)([-._][^/]*)?$/i;
const NOTICE_FILE = /^notice([-._][^/]*)?$/i;

export function noticeFor(dir, name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile());
  const lic = files.filter(f => LICENSE_FILE.test(f));
  const notice = files.filter(f => NOTICE_FILE.test(f));
  return {
    name: pkg.name ?? name, version: String(pkg.version ?? ''), license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? ''),
    licenseFiles: lic.map(f => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') })),
    noticeFiles: notice.map(f => ({ file: f, text: fs.readFileSync(path.join(dir, f), 'utf8') })),
  };
}

/** 실은 번들들의 소스맵 → 고지 목록. 라이선스 원문이 없으면 멈춘다 */
export function thirdPartyNotices(bundles) {
  const byKey = new Map();
  for (const b of bundles) {
    if (!fs.existsSync(b.map)) { throw new Error(`번들의 소스맵이 없다 — 묶인 패키지를 알 수 없다: ${b.map}`); }
    for (const [dir, name] of packagesInMap(b.map, b.root)) {
      const n = noticeFor(dir, name);
      const key = `${n.name}@${n.version}`;
      const e = byKey.get(key) ?? { ...n, bundles: new Set() };
      e.bundles.add(b.shipped);
      byKey.set(key, e);
    }
  }
  const list = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  const missing = list.filter(e => e.licenseFiles.length === 0);
  if (missing.length) { throw new Error(`라이선스 원문이 없는 묶인 패키지: ${missing.map(e => `${e.name}@${e.version}`).join(', ')}`); }
  const apacheNoNotice = list.filter(e => /apache/i.test(e.license) && e.noticeFiles.length === 0);
  const text = [
    'StCFSD — 함께 묶은 제3자 소프트웨어(JavaScript 번들)',
    '',
    '이 목록은 설치본에 실은 각 번들의 소스맵에서 뽑았다(desktop/installer/stage.mjs). 함께 묶은 Python 과 그 패키지의 고지는',
    'resources/python/THIRD_PARTY_NOTICES.txt 와 resources/python/licenses/ 에, Electron · Chromium 의 고지는 설치 폴더의',
    'LICENSE.electron.txt · LICENSES.chromium.html 에 있다.',
    '',
    ...list.map(e => `- ${e.name} ${e.version} (${e.license || '라이선스 표기 없음 — 아래 원문'}) — ${[...e.bundles].join(', ')}`),
    '',
    ...list.flatMap(e => [
      '='.repeat(78),
      `${e.name} ${e.version}`,
      `라이선스: ${e.license || '(package.json 에 표기 없음)'}`,
      `들어 있는 곳: ${[...e.bundles].join(', ')}`,
      '='.repeat(78),
      ...e.licenseFiles.flatMap(f => [`--- ${f.file} ---`, f.text.trimEnd(), '']),
      ...e.noticeFiles.flatMap(f => [`--- ${f.file} ---`, f.text.trimEnd(), '']),
      '',
    ]),
  ].join('\n');
  return { text, packages: list.map(e => ({ name: e.name, version: e.version, license: e.license, files: [...e.licenseFiles, ...e.noticeFiles].map(f => f.file), bundles: [...e.bundles] })), apacheNoNotice };
}

/** out/ 이 Node 내장 · vscode 말고 require 하는 것(있으면 설치본에서 못 찾는다) */
function bareRequires(dir) {
  const builtins = new Set([...builtinModules, ...builtinModules.map(m => `node:${m}`), 'vscode']);
  const bad = new Set();
  for (const f of listFiles(dir).filter(x => x.endsWith('.js'))) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of t.matchAll(/require\(["']([^"'.][^"']*)["']\)/g)) {
      const name = m[1].startsWith('@') ? m[1].split('/').slice(0, 2).join('/') : m[1].split('/')[0];
      if (!builtins.has(name) && !builtins.has(m[1])) { bad.add(`${f}: ${m[1]}`); }
    }
  }
  return [...bad];
}

export function stage({ build = true } = {}) {
  const t0 = Date.now();
  say('▶ 묶음 준비');
  if (build) {
    fs.rmSync(freshOut, { recursive: true, force: true });
    run('npx', ['tsc', '-p', './', '--outDir', freshOut, '--sourceMap', 'false'], '확장 호스트(빈 폴더에 새로)');
    fs.rmSync(freshMedia, { recursive: true, force: true });
    run('npx', ['webpack', '--config', 'webpack.mcp.config.js', '--mode', 'production', '--output-path', freshMedia], 'MCP 서버 번들(빈 폴더에 새로)');
    run('npx', ['webpack', '--config', 'webpack.config.js', '--mode', 'production', '--output-path', freshMedia], '3D 뷰어 번들(빈 폴더에 새로)');
    run(process.execPath, [path.join('desktop', 'host', 'build.mjs')], '호스트 · 다리(desktop/host/dist)');
    run(process.execPath, [path.join('desktop', 'shell', 'build.mjs')], '껍데기(desktop/shell/dist)');
    run(process.execPath, [path.join('desktop', 'ui', 'build.mjs')], '새 검토 화면(desktop/ui/dist)');
  }
  for (const [what, f] of [['확장 호스트', path.join(freshOut, 'extension.js')], ['MCP 서버 번들', path.join(freshMedia, 'mcp-server.js')]]) {
    if (!fs.existsSync(f)) { throw new Error(`새로 만든 ${what}이 없다: ${f} — --no-build 없이 다시 돌린다`); }
  }
  fs.rmSync(stageDir, { recursive: true, force: true });
  const app = path.join(stageDir, 'app');
  const appRoot = path.join(stageDir, 'app-root');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  // app — 껍데기 · 호스트 공개 API · 틀 · 새 검토 화면 · 제거 도우미
  fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
  for (const f of ['main.js', 'preload.js']) { fs.copyFileSync(path.join(repoRoot, 'desktop', 'shell', 'dist', f), path.join(app, 'dist', f)); }
  copyTree(path.join(repoRoot, 'desktop', 'host', 'dist', 'index.js'), path.join(app, 'host', 'index.js'));
  copyTree(path.join(repoRoot, 'desktop', 'host', 'frame'), path.join(app, 'host', 'frame'));
  const uiSrc = path.join(repoRoot, 'desktop', 'ui');
  copyTree(path.join(uiSrc, 'index.html'), path.join(app, 'ui', 'index.html'));
  copyTree(path.join(uiSrc, 'dist'), path.join(app, 'ui', 'dist'), rel => rel.endsWith('.map'));
  if (fs.existsSync(path.join(uiSrc, 'style'))) { copyTree(path.join(uiSrc, 'style'), path.join(app, 'ui', 'style')); }
  copyTree(path.join(here, 'disconnect.cjs'), path.join(app, 'uninstall', 'disconnect.js'));
  fs.writeFileSync(path.join(app, 'package.json'), `${JSON.stringify({
    name: 'stcfsd', productName: 'StCFSD', version: rootPkg.version, description: 'StCFSD — 냉간성형강 단면 좌굴 해석 · 설계(독립 프로그램)',
    main: 'dist/main.js', author: rootPkg.publisher ?? 'StCFSD', license: rootPkg.license ?? 'UNLICENSED',
  }, null, 2)}\n`);

  // app-root — 확장 호스트가 읽는 것(저장소와 같은 모양). out/ · media/*.js 는 방금 빈 폴더에 만든 것
  copyTree(freshOut, path.join(appRoot, 'out'), rel => rel.endsWith('.map'));
  for (const f of fs.readdirSync(path.join(repoRoot, 'media'))) {
    if (!/\.(js|map)$/.test(f)) { copyTree(path.join(repoRoot, 'media', f), path.join(appRoot, 'media', f)); }
  }
  copyTree(freshMedia, path.join(appRoot, 'media'), rel => rel.endsWith('.map') || rel.endsWith('.LICENSE.txt'));
  for (const [rel, skip] of APP_ROOT) {
    const src = path.join(repoRoot, rel);
    if (!fs.existsSync(src)) { throw new Error(`없다: ${rel}`); }
    copyTree(src, path.join(appRoot, rel), skip);
  }
  const shippedPkg = { ...rootPkg };
  for (const k of PKG_DROP) { delete shippedPkg[k]; }
  fs.writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify(shippedPkg, null, 4)}\n`);

  // 실은 .js 의 sourceMappingURL 주석을 뺀다(맵은 싣지 않는다)
  let strippedMaps = 0;
  for (const f of listFiles(stageDir).filter(x => x.endsWith('.js'))) {
    const p = path.join(stageDir, f);
    const t = fs.readFileSync(p, 'utf8');
    const u = t.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
    if (u !== t) { fs.writeFileSync(p, u); strippedMaps += 1; }
  }

  // 제3자 고지 — 실은 번들의 소스맵에서
  const bundles = [
    { shipped: 'app-root/media/mcp-server.js', map: path.join(freshMedia, 'mcp-server.js.map'), root: repoRoot },
    ...fs.readdirSync(freshMedia).filter(f => /^viewer3d.*\.js$/.test(f)).map(f => ({ shipped: `app-root/media/${f}`, map: path.join(freshMedia, `${f}.map`), root: repoRoot })),
    { shipped: 'app/host/index.js', map: path.join(repoRoot, 'desktop', 'host', 'dist', 'index.js.map'), root: path.join(repoRoot, 'desktop') },
    { shipped: 'app/dist/main.js', map: path.join(repoRoot, 'desktop', 'shell', 'dist', 'main.js.map'), root: path.join(repoRoot, 'desktop', 'shell') },
    { shipped: 'app/dist/preload.js', map: path.join(repoRoot, 'desktop', 'shell', 'dist', 'preload.js.map'), root: path.join(repoRoot, 'desktop', 'shell') },
    { shipped: 'app/ui/dist/main.js', map: path.join(uiSrc, 'dist', 'main.js.map'), root: uiSrc },
  ];
  const notices = thirdPartyNotices(bundles);
  fs.writeFileSync(path.join(appRoot, 'THIRD_PARTY_NOTICES.txt'), notices.text.replace(/\r?\n/g, '\r\n'));
  const bare = bareRequires(path.join(appRoot, 'out'));
  if (bare.length) { throw new Error(`out/ 이 설치본에 없는 모듈을 require 한다:\n  ${bare.join('\n  ')}`); }

  const missing = REQUIRED.filter(r => !fs.existsSync(path.join(stageDir, r)));
  if (missing.length) { throw new Error(`묶음에 꼭 있어야 할 것이 없다:\n  ${missing.join('\n  ')}`); }
  const leaks = listFiles(stageDir).filter(r => /(^|\/)(node_modules|__pycache__|\.venv|docs|Example|test)(\/|$)|\.map$|\.pyc$|\.ts$/.test(r));
  if (leaks.length) { throw new Error(`넣지 않아야 할 것이 들어갔다:\n  ${leaks.slice(0, 20).join('\n  ')}`); }
  const pkgLeak = PKG_DROP.filter(k => k in JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')));
  if (pkgLeak.length) { throw new Error(`배포용 package.json 에 ${pkgLeak.join(', ')} 이 남았다`); }

  const files = listFiles(stageDir).map(r => { const a = path.join(stageDir, r); return { path: r, size: fs.statSync(a).size, sha256: sha256(a) }; });
  const by = top => files.filter(f => f.path.startsWith(`${top}/`)).reduce((n, f) => n + f.size, 0);
  // 빌드 출처 — 실은 것이 무엇에서 나왔나. 커밋 안 된 변경은 desktop/ 을 포함해 실을 것에 닿는 모든 곳에서 본다(V5-17)
  const dirtyFiles = git(['status', '--porcelain', '--untracked-files=all', '--', 'src', 'python', 'webview', 'media', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsconfig.mcp.json', 'tsconfig.webview.json', 'webpack.config.js', 'webpack.mcp.config.js', 'LICENSE', 'desktop'])
    .split('\n').filter(Boolean).map(l => l.slice(3)).filter(f => !f.startsWith('desktop/installer/build/'));
  const manifest = {
    schema: 'stcfsd-stage/2', createdAt: new Date().toISOString(), version: rootPkg.version,
    source: {
      gitHead: git(['rev-parse', 'HEAD']), gitDirty: dirtyFiles.length > 0, dirtyFiles, rebuilt: build,
      outExtensionSha256: sha256(path.join(freshOut, 'extension.js')), mcpServerSha256: sha256(path.join(freshMedia, 'mcp-server.js')),
    },
    totals: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), app: by('app'), appRoot: by('app-root') },
    thirdParty: notices.packages, sourceMapCommentsRemoved: strippedMaps,
    files,
  };
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  say(`  제3자 패키지 ${notices.packages.length}개(${notices.packages.map(p => `${p.name}@${p.version}`).join(', ')}) · 라이선스 원문 모두 있음${notices.apacheNoNotice.length ? ` · NOTICE 없는 Apache 패키지 ${notices.apacheNoNotice.map(p => p.name).join(', ')}` : ''}`);
  say(`  app ${human(manifest.totals.app)} · app-root ${human(manifest.totals.appRoot)} · ${files.length}개 파일 · sourceMappingURL 뺌 ${strippedMaps}곳`);
  say(`  git ${manifest.source.gitHead.slice(0, 7)} · ${dirtyFiles.length ? `커밋 안 된 변경 ${dirtyFiles.length}개(${dirtyFiles.slice(0, 4).join(', ')}${dirtyFiles.length > 4 ? ' …' : ''})` : '커밋 안 된 변경 없음'} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  say(`  → ${path.relative(repoRoot, stageDir)}/ (manifest.json)`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { stage({ build: !process.argv.includes('--no-build') }); }
  catch (err) { process.stderr.write(`\n묶음 준비 실패: ${err.message}\n`); process.exit(1); }
}
