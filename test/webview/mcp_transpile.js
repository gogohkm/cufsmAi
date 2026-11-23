// 시험들이 src/mcp/*.ts 를 한 폴더에 transpile 하는 공용 도구(R1-2). 고른 모듈이 불러오는 지역 모듈도 함께 쓴다:
//   server → recordTools(R1-2 의 기록 도구), bridge → actorScope → ../records/context → ./names(행위자 문맥).
// 한 폴더에 놓으려고 records 의 두 파일은 `records.context.js` · `records.names.js` 로 쓰고 그 require 글만 바꾼다(내용은 그대로).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEPS = { server: ['recordTools'], bridge: ['actorScope'] };

function transpileOne(abs) {
  const ts = require(path.join(ROOT, 'node_modules', 'typescript'));
  return ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
}

/** outDir 에 files(src/mcp 의 모듈 이름)와 그 지역 의존을 쓴다 */
function transpileMcp(outDir, files) {
  fs.mkdirSync(outDir, { recursive: true });
  const all = new Set(files);
  for (const f of files) { for (const d of DEPS[f] || []) { all.add(d); } }
  for (const f of all) {
    let js = transpileOne(path.join(ROOT, 'src', 'mcp', `${f}.ts`));
    js = js.replace(/require\((["'])\.\.\/records\/context\1\)/g, 'require("./records.context")');
    fs.writeFileSync(path.join(outDir, `${f}.js`), js);
  }
  if (all.has('actorScope')) {
    fs.writeFileSync(path.join(outDir, 'records.context.js'),
      transpileOne(path.join(ROOT, 'src', 'records', 'context.ts')).replace(/require\((["'])\.\/names\1\)/g, 'require("./records.names")'));
    fs.writeFileSync(path.join(outDir, 'records.names.js'), transpileOne(path.join(ROOT, 'src', 'records', 'names.ts')));
  }
}

module.exports = { transpileMcp };
