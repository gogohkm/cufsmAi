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

// 깨끗한 체크아웃(마일스톤 3 — 2026-11-25): `npm ci` 는 Electron 의 실행 파일을 받지 않는다(Electron 45 에는 postinstall 이 없고, 처음 띄울 때
// 받는다). electron-builder 설정의 electronDist 가 그 폴더라 없으면 「The specified electronDist does not exist」 로 멈춘다 — 없으면 여기서 받는다.
const electronDir = path.join(shellDir, 'node_modules', 'electron');
if (!fs.existsSync(path.join(electronDir, 'dist'))) {
  const install = path.join(electronDir, 'install.js');
  if (!fs.existsSync(install)) {
    process.stderr.write(`Electron 이 없다: ${path.relative(here, electronDir)}\n→ cd desktop/shell && npm ci\n`);
    process.exit(1);
  }
  say('▶ Electron 실행 파일이 없다 — 받는다(node_modules/electron/install.js)');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [install], { cwd: electronDir, stdio: 'inherit', windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(path.join(electronDir, 'dist'))) {
    process.stderr.write('Electron 실행 파일을 받지 못했다(네트워크 · 프록시를 확인) — desktop/shell 에서 `node node_modules/electron/install.js`\n');
    process.exit(1);
  }
}

// electron-builder 는 디버그 기록을 켜야 만든 NSIS 스크립트를 builder-debug.yml 에 남긴다 — 제거 단계(customUnInstall)가
// 정말 들어갔는지 보려고 켠다(V5-05). 그 기록에서 스크립트를 꺼내 build/dist/nsis-script.nsi 로 둔다.
if (!/electron-builder/.test(process.env.DEBUG ?? '')) { process.env.DEBUG = 'electron-builder'; }
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
const debugYml = path.join(buildDir, 'dist', 'builder-debug.yml');
if (!dirOnly && fs.existsSync(debugYml)) {
  // nsis:\n  script: |-\n    <스크립트 줄들(4칸 들여쓰기)>
  const lines = fs.readFileSync(debugYml, 'utf8').split(/\r?\n/);
  const at = lines.findIndex(l => /^\s+script: \|/.test(l));
  if (at >= 0) {
    const indent = /^(\s*)/.exec(lines[at + 1])[1].length;
    const body = [];
    for (let i = at + 1; i < lines.length && (lines[i].startsWith(' '.repeat(indent)) || lines[i] === ''); i++) { body.push(lines[i].slice(indent)); }
    const scriptFile = path.join(buildDir, 'dist', 'nsis-script.nsi');
    fs.writeFileSync(scriptFile, body.join('\n'));
    // 만든 스크립트는 우리 installer.nsh 를 싣고(그 안에 customUnInstall 매크로), 제거 구역은 템플릿 uninstaller.nsh 가
    // `!ifmacrodef customUnInstall` → `!insertmacro customUnInstall` 로 부른다(파일 지우기 RMDir 앞)
    const tpl = fs.readFileSync(path.join(require.resolve('app-builder-lib/package.json'), '..', 'templates', 'nsis', 'uninstaller.nsh'), 'utf8');
    const hook = body.some(l => /!include ".*installer\.nsh"/.test(l)) && body.some(l => /!include "uninstaller\.nsh"/.test(l))
      && /!ifmacrodef customUnInstall\s+!insertmacro customUnInstall/.test(tpl) && tpl.indexOf('!insertmacro customUnInstall') < tpl.indexOf('RMDir /r $INSTDIR');
    say(`  NSIS 스크립트 → ${path.relative(here, scriptFile)} · 제거 단계(installer.nsh 의 customUnInstall ← uninstaller.nsh, 파일 지우기 앞) ${hook ? '들어감' : '없음!'}`);
    if (!hook) { process.exitCode = 1; }
  } else { say('  builder-debug.yml 에 NSIS 스크립트가 없다'); }
}
const unpacked = path.join(buildDir, 'dist', 'win-unpacked');
if (fs.existsSync(unpacked)) {
  const res = path.join(unpacked, 'resources');
  say(`  ${path.relative(here, unpacked)}/  ${human(duBytes(unpacked))} = Electron ${human(duBytes(unpacked) - duBytes(res))} + python ${human(duBytes(path.join(res, 'python')))} + app-root ${human(duBytes(path.join(res, 'app-root')))} + app ${human(duBytes(path.join(res, 'app')))}`);
}
