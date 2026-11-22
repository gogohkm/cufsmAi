// 설치 묶음의 단위 시험 — 네트워크 · 창 없음. `cd desktop && npm test` 가 돌린다.
//  V5-14 · Python 고정값: 주소 · sha256 이 저장소에 있고, 캐시가 고정값과 다르면 멈춘다(쓰지 않는다).
//  V5-13 · 실행 모드: 설치본은 시험 · 개발 변수를 따르지 않는다(확인용 표시 파일이 있을 때만). 물음 신호는 창을 보이지 않는다.
//  V5-07 · 제3자 고지: 소스맵에서 묶인 패키지를 뽑고, 라이선스 원문이 없는 패키지가 있으면 멈춘다.
//  V5-12 · 명령줄의 여러 파일: 첫 것 + 나머지(알린다).
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..', '..');
const results = [];
const check = (name, ok, detail = '') => { results.push(!!ok); process.stdout.write(`${ok ? '  통과' : '  실패'}  ${name}${detail ? ` — ${detail}` : ''}\n`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stcfsd-inst-unit-'));

// ── V5-14 ──
const py = await import(pathToFileURL(path.join(here, '..', 'python.mjs')).href);
const pins = [py.PINS.embed, ...py.PINS.packages];
check('V5-14 · Python zip · 휠 둘의 주소와 sha256 이 저장소에 고정돼 있다(python.org · files.pythonhosted.org)',
  pins.length === 3 && pins.every(p => /^[0-9a-f]{64}$/.test(p.sha256) && /^https:\/\/(www\.python\.org|files\.pythonhosted\.org)\//.test(p.url)),
  pins.map(p => `${path.basename(p.url)} ${p.sha256.slice(0, 8)}…`).join(' · '));
const bad = path.join(tmp, 'cache.zip');
fs.writeFileSync(bad, 'tampered');
let err = '';
try { await py.download('https://www.python.org/never-fetched', bad, py.PINS.embed.sha256); } catch (e) { err = e.message; }
check('V5-14 · 캐시가 고정값과 다르면 받지도 쓰지도 않고 멈춘다', /고정값과 다르다/.test(err) && fs.readFileSync(bad, 'utf8') === 'tampered', err.split('\n')[0]);
err = '';
try { await py.download('https://www.python.org/x', path.join(tmp, 'nopin'), undefined); } catch (e) { err = e.message; }
check('V5-14 · 고정값이 없으면 받지 않는다', /고정한 sha256 이 없다/.test(err));

// ── V5-13 · V5-16c · V5-12 (껍데기의 순수 함수 — esbuild 로 묶지 않고 tsc 없이 읽으려 ts 를 간단히 옮긴다) ──
const esbuild = createRequire(path.join(desktop, 'shell', 'package.json'))('esbuild');
const load = rel => {
  const out = esbuild.buildSync({ entryPoints: [path.join(desktop, 'shell', 'src', rel)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, createRequire(import.meta.url));
  return m.exports;
};
const mode = load('mode.ts');
const pk = mode.runMode({ packaged: true, env: { STCFSD_SHELL_TEST: '1', STCFSD_PYTHON: 'x' }, verificationMarker: false });
const pkv = mode.runMode({ packaged: true, env: { STCFSD_SHELL_TEST: '1' }, verificationMarker: true });
const dev = mode.runMode({ packaged: false, env: { STCFSD_SHELL_TEST: '1' }, verificationMarker: false });
const env = mode.effectiveEnv({ STCFSD_SHELL_TEST: '1', STCFSD_PYTHON: 'p', STCFSD_CLAUDE_CONFIG: 'c', STCFSD_DOCUMENTS: 'd', PATH: 'keep' }, pk);
check('V5-13 · 설치본은 STCFSD_SHELL_TEST · STCFSD_PYTHON · STCFSD_CLAUDE_CONFIG · STCFSD_DOCUMENTS 를 따르지 않는다(표시 파일 없을 때)',
  !pk.test && !pk.devOverrides && !env.STCFSD_SHELL_TEST && !env.STCFSD_PYTHON && !env.STCFSD_CLAUDE_CONFIG && !env.STCFSD_DOCUMENTS && env.PATH === 'keep',
  JSON.stringify(pk));
check('V5-13 · 확인용 복사본(표시 파일)과 개발판은 시험 모드를 연다', pkv.test && pkv.verification && dev.test && !dev.verification);
const sigs = [{ focused: false, test: false }, { focused: true, test: false }, { focused: false, test: true }].map(mode.questionSignal);
check('V5-16c · 물음 신호(시험 · 실제 길이 같은 함수): 창을 보이거나 포커스를 가져가지 않는다 — 실제 길은 작업 표시줄만 깜빡인다',
  sigs.every(s => s.show === false && s.focus === false) && sigs[0].flash === true && sigs[1].flash === false && sigs[2].flash === false && sigs[2].count === true,
  JSON.stringify(sigs));
const asFile = path.join(tmp, 'ud-file'); fs.writeFileSync(asFile, 'x');
check('V5-11 · 사용자 폴더 자리가 파일이면 까닭을 돌려준다(쓸 수 있으면 없음)', !!mode.userDataProblem(asFile) && mode.userDataProblem(path.join(tmp, 'ud-ok')) === undefined,
  mode.userDataProblem(asFile));
const args = load('args.ts');
const a = args.parseArgs(['StCFSD.exe', 'C:\\m\\a.csd', '--user-data', 'C:\\u', 'C:\\m\\b.csd', '--open', 'C:\\m\\c.stcfsd', 'C:\\m\\a.csd'], 'C:\\', false);
check('V5-12b · 여러 파일 — 첫 것은 open, 나머지는 extra(알릴 것)', a.open === 'C:\\m\\a.csd' && JSON.stringify(a.extra) === JSON.stringify(['C:\\m\\b.csd', 'C:\\m\\c.stcfsd']),
  JSON.stringify(a));

// ── V5-07 ──
const stage = await import(pathToFileURL(path.join(here, '..', 'stage.mjs')).href);
const fake = path.join(tmp, 'proj');
const mk = (name, files) => { const d = path.join(fake, 'node_modules', ...name.split('/')); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, version: '1.2.3', license: 'MIT' })); for (const [f, t] of Object.entries(files)) { fs.writeFileSync(path.join(d, f), t); } };
mk('has-license', { LICENSE: 'MIT License text' });
mk('@scope/apache', { 'LICENSE.md': 'Apache text', 'NOTICE.md': 'notice text' });
mk('no-license', {});
fs.mkdirSync(path.join(fake, 'dist'), { recursive: true });
const map = (srcs, f) => { const p = path.join(fake, 'dist', f); fs.writeFileSync(p, JSON.stringify({ version: 3, sources: srcs, mappings: '' })); return p; };
const good = map(['webpack://x/./node_modules/has-license/index.js', 'webpack://x/./node_modules/@scope/apache/lib/a.js', 'webpack://x/./src/own.ts'], 'good.js.map');
const n = stage.thirdPartyNotices([{ shipped: 'good.js', map: good, root: fake }]);
check('V5-07 · 소스맵에서 묶인 패키지를 뽑아 이름 · 판 · 라이선스 원문 · NOTICE 를 싣는다(자기 소스는 빼고)',
  n.packages.length === 2 && n.text.includes('MIT License text') && n.text.includes('Apache text') && n.text.includes('notice text') && !n.text.includes('own.ts'),
  n.packages.map(p => `${p.name}@${p.version} ${p.files.join('+')}`).join(' · '));
const badMap = map(['../node_modules/no-license/index.js'], 'bad.js.map');
err = '';
try { stage.thirdPartyNotices([{ shipped: 'bad.js', map: badMap, root: fake }]); } catch (e) { err = e.message; }
check('V5-07 · 라이선스 원문이 없는 묶인 패키지가 있으면 멈춘다', /라이선스 원문이 없는/.test(err) && /no-license/.test(err), err);

fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter(r => !r).length;
process.stdout.write(`\n결과: ${results.length - failed}/${results.length} 통과\n`);
if (failed) { process.exitCode = 1; }
