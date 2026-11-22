/**
 * 웹뷰 HTML 고쳐 쓰기 — 호스트(`StcfsdPanel`)가 만든 문자열을 다리 출처에서 돌게 한다.
 *
 * 확장 소스(`src/webview/StcfsdPanel.ts` 의 `_getHtmlForWebview` · `_wrapBucklingReport`)와 `webview/` 는 고치지 않는다.
 * 돌려줄 때만 다음을 바꾼다.
 *  1. 리소스 주소: `https://file+.vscode-resource.vscode-cdn.net/<절대경로>`(`%2B` 꼴 포함) → `/res/<뿌리>/<상대경로>`.
 *     뿌리는 `webview/` · `media/` 둘(패널의 localResourceRoots 와 같다). 밖이면 `/res/denied`.
 *  2. CSP: 패널이 쓴 정책을 **그대로 두고** 세 곳만 바꾼다 — `cspSource`(`https://*.vscode-cdn.net`) → `'self'`,
 *     nonce → 새 nonce(요청마다), `connect-src 'self'` 더하기(주입한 수신부가 fetch · EventSource 를 쓴다).
 *     설계 패널의 `'unsafe-eval'`(3D 뷰어가 쓴다) 같은 나머지 지시는 그대로다. 원래 nonce 를 단 태그도 새 nonce 로.
 *  3. CSP meta 바로 뒤(웹뷰 스타일 · 스크립트보다 앞): 테마 변수 + VS Code 기본 스타일(`theme.ts`),
 *     `acquireVsCodeApi()` 대체물 + 메시지 수신부.
 *  4. `<body>`: `vscode-dark` / `vscode-light` 클래스와 `data-vscode-theme-kind`(VS Code 와 같은 이름).
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { themeBodyClass, themeCss, type ThemeName } from './theme';

export const DEFAULT_RESOURCE_ORIGIN = 'https://file+.vscode-resource.vscode-cdn.net';
/** 대체 모듈의 `webview.cspSource`(vscode/webview.ts 의 defaultResourceMapper) */
export const DEFAULT_CSP_SOURCE = 'https://*.vscode-cdn.net';

export interface ResourceRoot {
  /** URL 의 첫 마디(`/res/<name>/…`) */
  name: string;
  /** 절대 경로 */
  dir: string;
}

export interface InjectOptions {
  webviewId: string;
  viewType: string;
  theme: ThemeName;
  roots: ResourceRoot[];
}

/** 절대 파일 경로 → `/res/<뿌리>/<상대>`. 허용 뿌리 밖이면 undefined. Windows 는 대소문자를 가리지 않는다. */
export function resourceUrlFor(absPath: string, roots: ResourceRoot[]): string | undefined {
  const norm = path.resolve(absPath);
  for (const r of roots) {
    const rel = path.relative(r.dir, norm);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return `/res/${r.name}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
    }
  }
  return undefined;
}

/** VS Code 꼴 리소스 주소의 경로 부분 → 파일 경로(Windows 의 `/c:/…` 포함) */
function fsPathFromResourcePath(urlPath: string): string {
  let p: string;
  try { p = decodeURIComponent(urlPath); } catch { p = urlPath; }
  if (/^\/[a-zA-Z]:\//.test(p)) { p = p.slice(1); }
  return p;
}

export function rewriteResourceUrls(html: string, roots: ResourceRoot[]): string {
  // `Uri.toString()` 은 VS Code 처럼 authority 의 `+` 를 `%2B` 로 쓴다. 둘 다 받는다.
  const origin = DEFAULT_RESOURCE_ORIGIN.replace(/[.]/g, '\\.').replace('+', '(?:\\+|%2[Bb])');
  const re = new RegExp(`${origin}(/[^"'\\s)<>]*)`, 'g');
  return html.replace(re, (_m, p: string) => resourceUrlFor(fsPathFromResourcePath(p), roots) ?? '/res/denied');
}

/** 패널의 CSP 를 다리 출처 · 새 nonce 로. 없으면 undefined(그때는 최소 정책을 넣는다) */
export function rewriteCsp(policy: string, nonce: string): string {
  const parts = policy.replace(/\s+/g, ' ').split(';').map(s => s.trim()).filter(Boolean)
    .map(d => d.split(' ').map(tok => {
      if (tok === DEFAULT_CSP_SOURCE) { return "'self'"; }
      if (/^'nonce-[^']*'$/.test(tok)) { return `'nonce-${nonce}'`; }
      return tok;
    }).join(' '));
  if (!parts.some(d => d.startsWith('connect-src'))) { parts.push("connect-src 'self'"); }
  else {
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith('connect-src') && !parts[i].includes("'self'")) { parts[i] += " 'self'"; }
    }
  }
  return parts.join('; ');
}

/**
 * 수신부(웹뷰 안에서 app.js 보다 먼저 돈다). 평범한 ES2017 로 쓴다.
 *  - `acquireVsCodeApi()` → `{postMessage, getState, setState}`(VS Code 와 같이 한 번만). postMessage 는 묶어서
 *    `POST /api/wv/<id>/in?conn=` 로, 받는 것은 `GET /api/wv/<id>/out`(SSE)에서 표준 `message` 사건으로.
 *  - 연결이 끊겼다 다시 붙으면(두 번째 hello) 페이지를 다시 읽는다 — 다리가 지금 상태를 다시 보낸다(다시 보내기).
 *  - 다른 연결이 이 웹뷰를 가져가면(`superseded`) 멈추고 `<html data-stcfsd-bridge="superseded">` 로 표시한다.
 */
function clientScript(cfg: Record<string, unknown>): string {
  return `(function(){
"use strict";
var cfg=${JSON.stringify(cfg).replace(/</g, '\\u003c')};
var base='/api/wv/'+encodeURIComponent(cfg.id);
var conn=null,open=false,ever=false,dead=false,sending=false,outQ=[];
function send(){
  if(!open||dead||sending||outQ.length===0){return;}
  sending=true;
  var body='['+outQ.join(',')+']';outQ=[];
  fetch(base+'/in?conn='+encodeURIComponent(conn),{method:'POST',headers:{'Content-Type':'application/json'},body:body,credentials:'same-origin'})
    .then(function(r){if(r.status===409){stop('superseded');}})
    .catch(function(e){console.warn('[stcfsd-bridge] 보내기 실패 — 이 묶음은 버린다',e);})
    .then(function(){sending=false;send();});
}
function stop(why){dead=true;open=false;try{es.close();}catch(e){}document.documentElement.setAttribute('data-stcfsd-bridge',why);}
var memState;var stateKey='stcfsd.wv.state.'+cfg.viewType;var acquired=false;
window.acquireVsCodeApi=function(){
  if(acquired){throw new Error('An instance of the VS Code API has already been acquired');}
  acquired=true;
  return Object.freeze({
    postMessage:function(m){outQ.push(JSON.stringify(m===undefined?null:m));send();},
    getState:function(){try{var s=sessionStorage.getItem(stateKey);return s==null?memState:JSON.parse(s);}catch(e){return memState;}},
    setState:function(s){memState=s;try{sessionStorage.setItem(stateKey,JSON.stringify(s));}catch(e){}return s;}
  });
};
var received=0;
var es=new EventSource(base+'/out');
es.addEventListener('hello',function(e){
  var d=JSON.parse(e.data);
  if(ever){location.reload();return;}
  ever=true;conn=d.conn;open=true;document.documentElement.setAttribute('data-stcfsd-bridge','connected');send();
});
es.addEventListener('superseded',function(){stop('superseded');});
es.addEventListener('replayed',function(e){document.documentElement.setAttribute('data-stcfsd-replayed',e.data);});
es.onmessage=function(e){
  var msg;try{msg=JSON.parse(e.data);}catch(err){return;}
  received++;
  window.dispatchEvent(new MessageEvent('message',{data:msg,origin:location.origin}));
};
es.onerror=function(){if(!dead){open=false;}};
window.__stcfsdBridge={id:cfg.id,viewType:cfg.viewType,get connected(){return open;},get received(){return received;}};
})();`;
}

export interface InjectResult { html: string; csp: string; nonce: string }

export function injectWebviewHtml(html: string, o: InjectOptions): InjectResult {
  const nonce = crypto.randomBytes(18).toString('base64');
  let out = rewriteResourceUrls(html, o.roots);
  // 원래 CSP meta 를 다시 쓴다(없으면 최소 정책을 넣는다). content 는 여러 줄일 수 있다.
  const metaRe = /<meta\s+http-equiv=["']Content-Security-Policy["']\s+content=(["'])([\s\S]*?)\1\s*\/?>/i;
  const m = metaRe.exec(out);
  const csp = m ? rewriteCsp(m[2], nonce)
    : `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`;
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  out = m ? out.replace(metaRe, cspMeta) : out.replace(/<head[^>]*>/i, h => `${h}\n${cspMeta}`);
  // 원래 nonce 를 새 nonce 로(스크립트 태그가 원래 nonce 를 달고 있다).
  out = out.replace(/\snonce=["'][^"']*["']/gi, ` nonce="${nonce}"`);
  const cfg = { id: o.webviewId, viewType: o.viewType };
  const headInject = `\n<style id="stcfsd-bridge-theme">${themeCss(o.theme)}</style>`
    + `\n<script nonce="${nonce}" id="stcfsd-bridge-client">${clientScript(cfg)}</script>`;
  // CSP meta 바로 뒤(= 웹뷰의 스타일 · 스크립트보다 앞)
  out = out.replace(cspMeta, cspMeta + headInject);
  const bodyClass = themeBodyClass(o.theme);
  out = out.replace(/<body([^>]*)>/i, (_b, attrs: string) => {
    if (/\sclass=["']/i.test(attrs)) {
      return `<body${attrs.replace(/\sclass=(["'])/i, ` class=$1${bodyClass} `)} data-vscode-theme-kind="${bodyClass}">`;
    }
    return `<body${attrs} class="${bodyClass}" data-vscode-theme-kind="${bodyClass}">`;
  });
  return { html: out, csp, nonce };
}
