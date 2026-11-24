/**
 * 화면에 주는 것 — 이것뿐이다. 화면(틀 · 웹뷰)은 보통 브라우저에서도 돌아야 하므로 기능을 여기에 넣지 않는다.
 * 화면은 `window.stcfsdShell?.isElectron` 으로 창 안인지만 안다. sandbox 에서 돌므로 require 는 'electron' 하나만 된다.
 */
import { contextBridge, ipcRenderer } from 'electron';

/*
 * V9b-08 · S1: 사람만 하는 길(층 4)의 「사람의 입력」 — 이 문서(맨 위 틀)의 capture 단계에서 isTrusted 인 누름 · 키만 주 프로세스에 알린다.
 * preload 는 맨 위 틀에서만 돈다(nodeIntegrationInSubFrames: false). 끼운 iframe 안의 입력은 이 문서로 오지 않고, 스크립트가 만든 사건은 isTrusted 가 아니다
 */
const tell = (e: Event): void => { if (e.isTrusted) { ipcRenderer.send('stcfsd:person-input'); } };
window.addEventListener('pointerdown', tell, true);
window.addEventListener('keydown', tell, true);

const version = (() => {
  const arg = process.argv.find(a => a.startsWith('--stcfsd-version='));
  return arg ? arg.slice('--stcfsd-version='.length) : '';
})();

contextBridge.exposeInMainWorld('stcfsdShell', Object.freeze({
  isElectron: true,
  platform: process.platform,
  version,
}));
