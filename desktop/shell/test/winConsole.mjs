// 껍데기의 순수 함수 단위 시험 — 자식 콘솔 숨김(winConsole) · 명령줄(args) · 창 자리(windowState).
// Electron 없이 돈다. src/*.ts 를 esbuild 로 임시 CommonJS 로 묶어 불러온다.
//
//   node desktop/shell/test/winConsole.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-shell-unit-'));
const out = path.join(tmp, 'unit.js');
await build({
  stdin: { contents: "export * from './winConsole'; export * from './args'; export * from './windowState';", resolveDir: path.join(here, '..', 'src'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent',
});
const U = require(out);
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── withWindowsHide ──
const cb = () => {};
check('spawn(f) → 옵션을 붙인다', eq(U.withWindowsHide(['f'], 1), ['f', { windowsHide: true }]));
check('spawn(f, args) → 끝에 붙인다', eq(U.withWindowsHide(['f', ['-u']], 1), ['f', ['-u'], { windowsHide: true }]));
check('spawn(f, args, opts) → opts 에 채운다(다른 키 그대로)', eq(U.withWindowsHide(['f', ['-u'], { cwd: 'x' }], 1), ['f', ['-u'], { cwd: 'x', windowsHide: true }]));
check('windowsHide:false 를 준 것은 그대로 둔다', eq(U.withWindowsHide(['f', [], { windowsHide: false }], 1), ['f', [], { windowsHide: false }]));
const ex = U.withWindowsHide(['cmd', cb], 1);
check('exec(cmd, cb) → 콜백 앞에 옵션', ex.length === 3 && eq(ex[1], { windowsHide: true }) && ex[2] === cb);
check('execSync(cmd, {stdio}) → 채운다(확장의 Python 점검 꼴)', eq(U.withWindowsHide(['"py" --version', { stdio: 'pipe', timeout: 10000 }], 1), ['"py" --version', { stdio: 'pipe', timeout: 10000, windowsHide: true }]));
const fakeCp = { spawn: (...a) => a, execSync: (...a) => a, exec: (...a) => a };
const wrapped = U.hideChildConsoles(fakeCp, 'win32');
check('hideChildConsoles — Windows 에서 감싼다(두 번 감싸지 않는다)', wrapped.includes('spawn') && wrapped.includes('execSync') && U.hideChildConsoles(fakeCp, 'win32').length === 0
  && eq(fakeCp.spawn('python', ['-u', 'server.py'], { cwd: 'p' })[2], { cwd: 'p', windowsHide: true }), wrapped.join(', '));
check('Windows 가 아니면 감싸지 않는다', U.hideChildConsoles({ spawn: () => 0 }, 'linux').length === 0);

// ── parseArgs ──
const cwd = path.resolve(tmp);
check('파일 연결 꼴: StCFSD.exe "a.csd"', eq(U.parseArgs(['StCFSD.exe', 'a.csd'], cwd, false), { open: path.join(cwd, 'a.csd') }));
check('개발판: electron . a.csd --user-data d --theme light', eq(U.parseArgs(['electron.exe', '.', 'a.csd', '--user-data', 'd', '--theme', 'light'], cwd, true),
  { open: path.join(cwd, 'a.csd'), userData: path.join(cwd, 'd'), theme: 'light' }));
check('--open=x.csd · Chromium 스위치는 무시', eq(U.parseArgs(['StCFSD.exe', '--enable-logging', '--open=x.csd'], cwd, false), { open: path.join(cwd, 'x.csd') }));
check('.csd 가 아닌 맨 인자는 열지 않는다', eq(U.parseArgs(['StCFSD.exe', 'readme.txt'], cwd, false), {}));
check('--ui: 새 검토 화면(U1) — 없으면 틀(기본)', eq(U.parseArgs(['electron.exe', '.', '--ui', 'a.csd'], cwd, true), { ui: true, open: path.join(cwd, 'a.csd') })
  && U.parseArgs(['StCFSD.exe', 'a.csd'], cwd, false).ui === undefined);

// ── placeWindow ──
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const second = { id: 2, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
const p0 = U.placeWindow(undefined, [primary], primary);
check('처음: 주 모니터 가운데 기본 크기', p0.where === 'default' && p0.bounds.width === 1600 && p0.bounds.x === 160, JSON.stringify(p0.bounds));
const p1 = U.placeWindow({ bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: true, displayId: 2 }, [primary, second], primary);
check('저장한 둘째 모니터가 있으면 그 자리 · 최대화', p1.where === 'saved' && p1.bounds.x === 2000 && p1.maximized && p1.displayId === 2);
const p2 = U.placeWindow({ bounds: { x: 2000, y: 100, width: 1400, height: 900 }, maximized: false, displayId: 2 }, [primary], primary);
check('둘째 모니터를 뺐으면 주 모니터 가운데(같은 크기)', p2.where === 'primary-fallback' && p2.bounds.width === 1400 && p2.bounds.x === 260, JSON.stringify(p2.bounds));
const p3 = U.placeWindow({ bounds: { x: 10, y: 10, width: 3000, height: 2000 }, maximized: false, displayId: 1 }, [primary], primary);
check('작업 영역보다 크면 줄인다', p3.bounds.width === 1920 && p3.bounds.height === 1040);
const wf = path.join(tmp, 'w.json');
U.writeWindowState(wf, { bounds: { x: 1, y: 2, width: 1000, height: 700 }, maximized: false, displayId: 1 });
check('window.json 쓰기 · 읽기', eq(U.readWindowState(wf)?.bounds, { x: 1, y: 2, width: 1000, height: 700 }));
fs.writeFileSync(wf, '{broken');
check('깨진 window.json 은 없는 것으로', U.readWindowState(wf) === undefined);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(r => !r).length;
process.stdout.write(`\n결과: ${results.length - failed}/${results.length} 통과\n`);
if (failed) { process.exitCode = 1; }
