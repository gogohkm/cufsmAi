/* global require, module, process, console, __dirname */
// 기록(R1-1 · R2-1 · R3-1) 시험의 공용 장치 — 브라우저 · 파이썬 없이.
//  - TS 를 그 자리에서 옮겨 싣는다(test/webview/panel_harness.js 의 loadTs 와 같은 방식). out/ 을 쓰지 않는다.
//  - STCFSD_RECORDS_SRC 를 주면 그 폴더(src 와 같은 모양 — records/ · mcp/siUnits.ts)에서 싣는다(돌연변이 시험용).
//  - 임시 폴더는 os.tmpdir() 아래에만, 끝나면 모두 지운다. 열쇠 자리는 늘 임시 폴더(진짜 %LOCALAPPDATA% 를 쓰지 않는다).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = process.env.STCFSD_RECORDS_SRC ? path.resolve(process.env.STCFSD_RECORDS_SRC) : path.join(ROOT, 'src');
const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
const cache = new Map();

function load(absFile) {
  if (cache.has(absFile)) { return cache.get(absFile).exports; }
  const src = fs.readFileSync(absFile, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: absFile,
  }).outputText;
  const mod = { exports: {} };
  cache.set(absFile, mod);
  const localRequire = (req) => {
    if (req.startsWith('.')) {
      const base = path.resolve(path.dirname(absFile), req);
      for (const c of [base + '.ts', path.join(base, 'index.ts'), base + '.js']) {
        if (fs.existsSync(c)) { return c.endsWith('.ts') ? load(c) : require(c); }
      }
      throw new Error(`cannot resolve ${req} from ${absFile}`);
    }
    if (req === 'vscode') { throw new Error('records modules must not import vscode'); }
    return Module.createRequire(absFile)(req);
  };
  new Function('exports', 'module', 'require', '__filename', '__dirname', js)(mod.exports, mod, localRequire, absFile, path.dirname(absFile));
  return mod.exports;
}
const rec = (name) => load(path.join(SRC, 'records', name + '.ts'));

const temps = [];
function tmp(prefix = 'stcfsd-rec-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(d);
  return fs.realpathSync.native(d);
}
function cleanupTemps() {
  for (const d of temps.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 남으면 run.js 가 알린다 */ } }
}

/** 링크 · junction 만들기 — 권한이 없으면 null(시험은 건너뜀을 알린다) */
function tryLink(target, at, type) {
  try { fs.symlinkSync(target, at, type); return at; } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') { return null; } throw e; }
}

function suite(name) {
  const results = [];
  const skipped = [];
  const t = async (title, fn) => {
    try { const r = await fn(); if (r === 'skip') { skipped.push(title); } else { results.push([title, true]); } }
    catch (e) { results.push([title, false, e]); }
  };
  const done = () => {
    for (const [title, ok, e] of results) { if (!ok) { console.log(`  FAIL ${name} :: ${title}\n       ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n       ') : e}`); } }
    for (const s of skipped) { console.log(`  SKIP ${name} :: ${s}`); }
    const pass = results.filter((r) => r[1]).length;
    console.log(`${name}: ${pass}/${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ''}`);
    return { pass, total: results.length, skipped: skipped.length };
  };
  return { t, done };
}

module.exports = { ROOT, SRC, rec, tmp, cleanupTemps, tryLink, suite };
