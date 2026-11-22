#!/usr/bin/env node
// S5 · 묶음 준비 — 설치본에 들어갈 파일을 저장소에서 골라 desktop/installer/build/stage/ 로 모은다.
//
//   node desktop/installer/stage.mjs             빌드 셋을 **먼저 다시 돌린 뒤**(낡은 out/ 를 싣지 않게) 모은다
//   --no-build                                    다시 빌드하지 않는다(이미 방금 빌드했을 때 — 시험용)
//
// 다시 돌리는 빌드(저장소 루트에서): `npx tsc -p ./ --outDir build/out-fresh --sourceMap false`(확장 호스트를 **빈 폴더에** 새로 —
// tsc 는 옛 출력을 지우지 않아 저장소의 out/ 에는 지금 소스에 없는 파일이 남아 있을 수 있다. 그 out/ 은 싣지 않는다),
// `node desktop/host/build.mjs`(호스트 · 다리), `node desktop/shell/build.mjs`(껍데기 main · preload). 쓰는 곳은 build/ · desktop/*/dist 뿐이다.
//
// 만드는 것(설치본의 <resources>/ 아래 모양 그대로 — README 의 그림):
//   stage/app/        → resources/app/       package.json(만든 것) · dist/main.js · dist/preload.js · host/index.js · host/frame/*
//   stage/app-root/   → resources/app-root/  확장 호스트가 읽는 것: package.json · out/ · python/(소스만) · webview/ · media/ · LICENSE
//   stage/manifest.json                      묶은 파일 · 크기 · sha256 · 빌드 출처
// 넣지 않는 것: 저장소 루트의 node_modules · docs · Example · test · .venv · src(TypeScript 원본) · *.map · __pycache__ · *.pyc ·
// 시험 파일. Python 은 여기서 모으지 않는다 — python.mjs 가 build/python-win-x64/ 에 만들고 electron-builder 가 resources/python/ 으로 가져간다.
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const buildDir = path.join(here, 'build');
export const stageDir = path.join(buildDir, 'stage');
/** 확장 호스트를 새로 컴파일하는 빈 폴더 — app-root/out 이 된다 */
const freshOut = path.join(buildDir, 'out-fresh');
const say = s => process.stdout.write(`${s}\n`);
const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** 확장 호스트 폴더(app-root)에 넣는 것: [저장소 기준 폴더 · 파일, 빼는 규칙] */
const APP_ROOT = [
  ['package.json'], ['LICENSE'],
  ['python', rel => /(^|\/)(__pycache__|tests?)(\/|$)/.test(rel) || /\.pyc$/.test(rel) || /(^|\/)test_[^/]*\.py$|_test\.py$/.test(rel)],
  ['webview', rel => rel.endsWith('.map')],
  ['media', rel => rel.endsWith('.map')],
];
/** 있어야만 하는 것(빠지면 설치본이 뜨지 않는다) */
const REQUIRED = [
  'app/package.json', 'app/dist/main.js', 'app/dist/preload.js', 'app/host/index.js', 'app/host/frame/index.html', 'app/host/frame/frame.js',
  'app-root/package.json', 'app-root/out/extension.js', 'app-root/out/webview/StcfsdPanel.js', 'app-root/out/mcp/bridge.js',
  'app-root/out/mcp/portFile.js', 'app-root/out/mcp/claudeDesktop.js', 'app-root/python/server.py', 'app-root/python/engine/fsm_solver.py',
  'app-root/webview/js/app.js', 'app-root/webview/css/theme.css', 'app-root/media/mcp-server.js', 'app-root/media/viewer3d.js',
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
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : '';
}

export function stage({ build = true } = {}) {
  const t0 = Date.now();
  say('▶ 묶음 준비');
  if (build) {
    fs.rmSync(freshOut, { recursive: true, force: true });
    run('npx', ['tsc', '-p', './', '--outDir', freshOut, '--sourceMap', 'false'], '확장 호스트(빈 폴더에 새로)');
    run(process.execPath, [path.join('desktop', 'host', 'build.mjs')], '호스트 · 다리(desktop/host/dist)');
    run(process.execPath, [path.join('desktop', 'shell', 'build.mjs')], '껍데기(desktop/shell/dist)');
  }
  fs.rmSync(stageDir, { recursive: true, force: true });
  const app = path.join(stageDir, 'app');
  const appRoot = path.join(stageDir, 'app-root');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  // app — 껍데기 · 호스트 공개 API · 틀
  fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
  for (const f of ['main.js', 'preload.js']) { fs.copyFileSync(path.join(repoRoot, 'desktop', 'shell', 'dist', f), path.join(app, 'dist', f)); }
  copyTree(path.join(repoRoot, 'desktop', 'host', 'dist', 'index.js'), path.join(app, 'host', 'index.js'));
  copyTree(path.join(repoRoot, 'desktop', 'host', 'frame'), path.join(app, 'host', 'frame'));
  fs.writeFileSync(path.join(app, 'package.json'), `${JSON.stringify({
    name: 'stcfsd', productName: 'StCFSD', version: rootPkg.version, description: 'StCFSD — 냉간성형강 단면 좌굴 해석 · 설계(독립 프로그램)',
    main: 'dist/main.js', author: rootPkg.publisher ?? 'StCFSD', license: rootPkg.license ?? 'UNLICENSED',
  }, null, 2)}\n`);

  // app-root — 확장 호스트가 읽는 것(저장소와 같은 모양). out/ 은 방금 빈 폴더에 컴파일한 것
  if (!fs.existsSync(path.join(freshOut, 'extension.js'))) { throw new Error(`새로 컴파일한 확장 호스트가 없다: ${freshOut} — --no-build 없이 다시 돌린다`); }
  copyTree(freshOut, path.join(appRoot, 'out'), rel => rel.endsWith('.map'));
  for (const [rel, skip] of APP_ROOT) {
    const src = path.join(repoRoot, rel);
    if (!fs.existsSync(src)) { throw new Error(`없다: ${rel}`); }
    copyTree(src, path.join(appRoot, rel), skip);
  }

  const missing = REQUIRED.filter(r => !fs.existsSync(path.join(stageDir, r)));
  if (missing.length) { throw new Error(`묶음에 꼭 있어야 할 것이 없다:\n  ${missing.join('\n  ')}`); }
  const leaks = listFiles(stageDir).filter(r => /(^|\/)(node_modules|__pycache__|\.venv|docs|Example|test)(\/|$)|\.map$|\.pyc$|\.ts$/.test(r));
  if (leaks.length) { throw new Error(`넣지 않아야 할 것이 들어갔다:\n  ${leaks.slice(0, 20).join('\n  ')}`); }

  const files = listFiles(stageDir).map(r => { const a = path.join(stageDir, r); return { path: r, size: fs.statSync(a).size, sha256: sha256(a) }; });
  const by = top => files.filter(f => f.path.startsWith(`${top}/`)).reduce((n, f) => n + f.size, 0);
  const manifest = {
    schema: 'stcfsd-stage/1', createdAt: new Date().toISOString(), version: rootPkg.version,
    source: { gitHead: git(['rev-parse', 'HEAD']), gitDirty: git(['status', '--porcelain', '--', 'src', 'python', 'webview', 'media', 'package.json']) !== '',
      rebuilt: build, outExtensionSha256: sha256(path.join(freshOut, 'extension.js')) },
    totals: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), app: by('app'), appRoot: by('app-root') },
    files,
  };
  fs.writeFileSync(path.join(stageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  say(`  app ${human(manifest.totals.app)} · app-root ${human(manifest.totals.appRoot)} · ${files.length}개 파일 · git ${manifest.source.gitHead.slice(0, 7)}${manifest.source.gitDirty ? '(+ 커밋 안 된 변경)' : ''} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  say(`  → ${path.relative(repoRoot, stageDir)}/ (manifest.json)`);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { stage({ build: !process.argv.includes('--no-build') }); }
  catch (err) { process.stderr.write(`\n묶음 준비 실패: ${err.message}\n`); process.exit(1); }
}
