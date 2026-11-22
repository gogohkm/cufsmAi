#!/usr/bin/env node
// S5 · 설치 파일 만들기 — stage.mjs · python.mjs 가 만든 것을 electron-builder 로 묶는다.
//
//   node desktop/installer/build.mjs --win          Windows x64 NSIS 설치 파일(+ win-unpacked/)
//   node desktop/installer/build.mjs --win --dir    풀린 폴더만(win-unpacked/)
//   node desktop/installer/build.mjs --all          stage → python → 설치 파일을 한 번에
//
// 출력: desktop/installer/build/dist/ (git 이 무시한다). electron-builder 는 desktop/shell 의 개발 의존성이다.
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(here, '..', 'shell');
const buildDir = path.join(here, 'build');
const require = createRequire(path.join(shellDir, 'package.json'));
const say = s => process.stdout.write(`${s}\n`);
const human = n => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MiB` : `${(n / 1024).toFixed(0)} KiB`);
function duBytes(p) {
  let st; try { st = fs.lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) { return st.size; }
  let n = 0; for (const x of fs.readdirSync(p)) { n += duBytes(path.join(p, x)); } return n;
}

const argv = process.argv.slice(2);
if (argv.includes('--all')) {
  const { stage } = await import('./stage.mjs');
  const { buildPython } = await import('./python.mjs');
  stage({ build: true });
  await buildPython({});
} else if (!argv.includes('--win')) {
  process.stderr.write('사용법: node desktop/installer/build.mjs --win [--dir] | --all\n');
  process.exit(2);
}
const dirOnly = argv.includes('--dir');
const need = [path.join(buildDir, 'stage', 'manifest.json'), path.join(buildDir, 'stage', 'app', 'package.json'), path.join(buildDir, 'python-win-x64', 'STCFSD_PYTHON.json')];
const absent = need.filter(f => !fs.existsSync(f));
if (absent.length) {
  process.stderr.write(`먼저 만들 것이 없다:\n${absent.map(f => `  ${path.relative(here, f)}`).join('\n')}\n→ node desktop/installer/stage.mjs && node desktop/installer/python.mjs\n`);
  process.exit(1);
}

const builder = require('electron-builder');
const config = require(path.join(here, 'electron-builder.config.cjs'));
const { Platform, Arch } = builder;
const t0 = Date.now();
fs.rmSync(path.join(buildDir, 'dist'), { recursive: true, force: true });
const out = await builder.build({ projectDir: shellDir, targets: Platform.WINDOWS.createTarget(dirOnly ? ['dir'] : ['nsis'], Arch.x64), config }).catch(err => {
  process.stderr.write(`\nelectron-builder 실패: ${err?.stack ?? err}\n`);
  process.exit(1);
});
say(`\n▶ ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const f of out ?? []) { if (fs.existsSync(f) && fs.statSync(f).isFile()) { say(`  ${path.relative(here, f)}  ${human(fs.statSync(f).size)}`); } }
const unpacked = path.join(buildDir, 'dist', 'win-unpacked');
if (fs.existsSync(unpacked)) {
  const res = path.join(unpacked, 'resources');
  say(`  ${path.relative(here, unpacked)}/  ${human(duBytes(unpacked))} = Electron ${human(duBytes(unpacked) - duBytes(res))} + python ${human(duBytes(path.join(res, 'python')))} + app-root ${human(duBytes(path.join(res, 'app-root')))} + app ${human(duBytes(path.join(res, 'app')))}`);
}
