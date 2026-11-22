// S5 · electron-builder 설정. build.mjs 가 읽어 쓴다(직접: cd desktop/shell && npx electron-builder --config ../installer/electron-builder.config.cjs --win).
//
// 설치본의 resources/ 배치(desktop/shell/src/layout.ts 의 'installed' 와 같아야 한다 — 바꾸면 둘을 같이 바꾼다):
//   resources/app/        stage/app      package.json · dist/main.js · dist/preload.js · host/index.js · host/frame/*
//   resources/app-root/   stage/app-root 확장 호스트(out) · 엔진(python) · webview · media(mcp-server.js) · package.json
//   resources/python/     build/python-win-x64  CPython 3.13 embeddable + numpy · scipy(python.mjs)
//
// asar 를 쓰지 않는다(asar: false). Python 자식 프로세스(python.exe · server.py)와 Claude Desktop 이 띄우는 stdio MCP 서버
// (StCFSD.exe <resources>\app-root\media\mcp-server.js)는 디스크의 진짜 파일이어야 한다 — 그것들은 어차피 asar 밖(extraResources)이고,
// asar 에 넣을 수 있는 것은 껍데기 · 호스트 묶음 세 파일 + 틀(약 170 KiB)뿐이라 asar 로 얻는 것(파일 수 · 읽기 속도)이 없다.
// 반면 다리는 틀을 fs.realpathSync · createReadStream 으로 내주므로 asar 의 fs 흉내에 기대지 않는 편이 안전하다.
const fs = require('node:fs');
const path = require('node:path');

const here = __dirname;
const build = path.join(here, 'build');
const stage = path.join(build, 'stage');
const shellDir = path.join(here, '..', 'shell');
const shellPkg = JSON.parse(fs.readFileSync(path.join(shellDir, 'package.json'), 'utf8'));
const icons = path.join(here, 'icons');
// 저장소에는 앱 아이콘(.ico)이 없다(media/stcfsd-icon.svg 는 VS Code 용 SVG). icons/icon.ico(256px 포함)를 넣으면 쓴다 — 없으면 Electron 기본 아이콘.
const winIcon = fs.existsSync(path.join(icons, 'icon.ico')) ? path.join(icons, 'icon.ico') : undefined;
/** extraResources 를 그대로 둔다(electron-builder 의 기본 거름을 쓰지 않게 filter 를 준다) */
const all = ['**/*'];

module.exports = {
  // ★ 바꾸지 않는다 — 한 번 배포한 뒤로는 영원히 이 값이다. Windows 의 AppUserModelID(작업 표시줄 묶음 · 알림)이고, NSIS 가
  //   이것으로 설치 GUID(제거 정보의 레지스트리 키)를 만든다. 바꾸면 덮어 설치가 안 되고 옛 판이 「다른 프로그램」으로 남는다.
  //   같은 사람의 StAnal 은 local.stanal.desktop — 같은 꼴로 정했다.
  appId: 'local.stcfsd.desktop',
  productName: 'StCFSD',
  executableName: 'StCFSD',
  copyright: 'StCFSD · Jeil Structural Engineering Consultants · 사내용',
  electronVersion: shellPkg.devDependencies.electron,
  // 이미 받은 Electron(desktop/shell/node_modules/electron/dist)을 쓴다 — electron-builder 가 다시 받지 않는다.
  electronDist: path.join(shellDir, 'node_modules', 'electron', 'dist'),
  directories: { app: path.join(stage, 'app'), output: path.join(build, 'dist'), buildResources: icons },
  asar: false,
  files: ['**/*'],
  extraResources: [
    { from: path.join(stage, 'app-root'), to: 'app-root', filter: all },
    { from: path.join(build, 'python-win-x64'), to: 'python', filter: all },
  ],
  // Chromium 언어 묶음(.pak)은 한국어 · 영어만(나머지 50여 개를 뺀다)
  electronLanguages: ['ko', 'en-US'],
  // 앱 폴더에 node_modules 가 없다(껍데기 · 호스트는 esbuild 묶음). 다시 빌드할 것이 없다.
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  publish: null,
  // Electron 퓨즈는 건드리지 않는다(electronFuses 를 두지 않는다). 특히 RunAsNode 를 끄면 Claude Desktop 이
  // `StCFSD.exe <resources>\app-root\media\mcp-server.js` + ELECTRON_RUN_AS_NODE=1 로 MCP 서버를 띄우지 못한다.
  fileAssociations: [
    { ext: 'csd', name: 'StCFSD.Project', description: 'StCFSD 단면 설계 프로젝트', role: 'Editor', ...(winIcon ? { icon: winIcon } : {}) },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    ...(winIcon ? { icon: winIcon } : {}),
    // 서명하지 않는다(인증서가 없으면 서명 단계는 건너뛴다) — 사용자는 SmartScreen 경고를 본다(README).
    // 실행 파일의 아이콘 · 버전 정보는 electron-builder 가 고친다(파일 설명 = StCFSD).
    signAndEditExecutable: true,
    legalTrademarks: 'StCFSD',
  },
  nsis: {
    // 사용자 단위 설치: %LOCALAPPDATA%\Programs\StCFSD. 관리자 권한을 묻지 않는다.
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    installerLanguages: ['ko_KR'],
    language: '1042',
    unicode: true,
    createDesktopShortcut: 'always',
    createStartMenuShortcut: true,
    shortcutName: 'StCFSD',
    uninstallDisplayName: 'StCFSD',
    // 제거할 때 %APPDATA%\StCFSD(설정 · 창 위치 · 로그 · MCP 포트 파일)는 남긴다. Claude Desktop 설정의 등록은 「끊기」로 지운다.
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    artifactName: 'StCFSD-Setup-${version}-x64.${ext}',
    ...(winIcon ? { installerIcon: winIcon, uninstallerIcon: winIcon } : {}),
  },
};
