// 호스트 빌드 — host/src 의 진입점 둘을 Node 20 용 CommonJS 한 파일씩으로 묶는다.
// 확장 호스트(out/extension.js, 루트의 tsc 출력)는 묶지 않는다. 적재기가 실행 시점에 require 한다.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: {
    index: path.join(here, 'src/index.ts'),
    headless: path.join(here, 'src/headless.ts'),
  },
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
});
