// 호스트 빌드 — host/src 의 진입점 셋을 Node 20 용 CommonJS 한 파일씩으로 묶는다.
// 확장 호스트(out/extension.js, 루트의 tsc 출력)는 묶지 않는다. 적재기가 실행 시점에 require 한다.
// 틀(host/frame/)은 묶지 않는다 — 다리가 그 폴더의 파일을 그대로 내준다.
//
// 빌드 뒤 확인: 웹뷰가 쓰는 `--vscode-*` 변수(webview/css · webview/js · src/webview/StcfsdPanel.ts)가 다리의 테마
// (dark · light)에 모두 정의돼 있어야 한다. 하나라도 없으면 빌드를 멈춘다 — 정의가 빠지면 배경이 투명해지고 테두리가 사라진다.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

await build({
  entryPoints: {
    index: path.join(here, 'src/index.ts'),
    headless: path.join(here, 'src/headless.ts'),
    serve: path.join(here, 'src/serve.ts'),
  },
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
});

/** 웹뷰 쪽 소스 글(테마 변수를 쓰는 곳) */
function webviewSourceTexts(root = repoRoot) {
  const files = [path.join(root, 'src', 'webview', 'StcfsdPanel.ts')];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); } else if (/\.(js|css|html)$/.test(e.name)) { files.push(p); }
    }
  };
  walk(path.join(root, 'webview'));
  return files.filter(f => fs.existsSync(f)).map(f => fs.readFileSync(f, 'utf8'));
}

const require = createRequire(import.meta.url);
const { usedThemeVariables, missingThemeVariables } = require('./dist/index.js');
const used = usedThemeVariables(webviewSourceTexts());
const missing = missingThemeVariables(used);
if (missing.length) {
  console.error(`빌드 실패 — 웹뷰가 쓰는데 다리 테마에 없는 변수 ${missing.length}건:\n`
    + missing.map(m => `  ${m.theme}: --vscode-${m.name}`).join('\n'));
  process.exit(1);
}
console.log(`  테마 변수: 웹뷰가 쓰는 ${used.length}종 모두 dark · light 에 정의됨`);
