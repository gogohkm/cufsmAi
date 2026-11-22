// 새 검토 화면(U1) 빌드 — src/main.ts 를 ES 모듈 한 파일(dist/main.js)로 묶고, 템플릿의 CSS 셋을 dist/ 로 복사한다.
// 다리의 CSP 가 script-src 'self' 라 인라인 스크립트는 없다. index.html · style/ui.css 는 그대로 쓴다.
//
// 단위 변환은 제품의 src/mcp/siUnits.ts 를 그대로 묶는다(MCP 도구가 units:"SI" 로 돌려줄 때 쓰는 그 표와 계수).
// 템플릿 CSS(desktop/design/assets 의 review.css · app.css · cfsd.css)는 고치지 않고 복사한다 — 승인된 모습 그대로.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(dist, 'main.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110'],
  sourcemap: true,
  logLevel: 'info',
});

const assets = path.join(here, '..', 'design', 'assets');
for (const f of ['review.css', 'app.css', 'cfsd.css']) {
  fs.copyFileSync(path.join(assets, f), path.join(dist, f));
}
console.log('  템플릿 CSS 셋을 dist/ 로 복사함(design/assets 그대로)');
