/**
 * 화면에 주는 것 — 이것뿐이다. 화면(틀 · 웹뷰)은 보통 브라우저에서도 돌아야 하므로 기능을 여기에 넣지 않는다.
 * 화면은 `window.stcfsdShell?.isElectron` 으로 창 안인지만 안다. sandbox 에서 돌므로 require 는 'electron' 하나만 된다.
 */
import { contextBridge } from 'electron';

const version = (() => {
  const arg = process.argv.find(a => a.startsWith('--stcfsd-version='));
  return arg ? arg.slice('--stcfsd-version='.length) : '';
})();

contextBridge.exposeInMainWorld('stcfsdShell', Object.freeze({
  isElectron: true,
  platform: process.platform,
  version,
}));
