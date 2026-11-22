// 껍데기 빌드 — 주 프로세스(main)와 preload 를 CommonJS 한 파일씩으로 묶는다.
// 호스트(../host/dist/index.js)는 묶지 않는다. 주 프로세스가 실행 시점에 배치(layout.ts)로 경로를 정해 require 한다.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'], logLevel: 'info' };

await build({ ...common, entryPoints: { main: path.join(here, 'src/main.ts') }, outdir: path.join(here, 'dist') });
// preload 는 sandbox 에서 돈다 — require 는 'electron' 하나만 된다. 다른 모듈을 끌어오지 않는다.
await build({ ...common, entryPoints: { preload: path.join(here, 'src/preload.ts') }, outdir: path.join(here, 'dist') });
