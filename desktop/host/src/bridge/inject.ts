/**
 * 웹뷰 HTML 고쳐 쓰기 — 호스트(`StcfsdPanel`)가 만든 문자열을 다리의 웹뷰 서버에서 돌게 한다.
 *
 * 확장 소스(`src/webview/StcfsdPanel.ts` 의 `_getHtmlForWebview` · `_wrapBucklingReport`)와 `webview/` 는 고치지 않는다.
 * 돌려줄 때만 다음을 바꾼다.
 *  1. 리소스 주소: `https://file+.vscode-resource.vscode-cdn.net/<절대경로>`(`%2B` 꼴 포함) → `/res/<뿌리>/<상대경로>`.
 *     뿌리는 `webview/` · `media/` 둘(패널의 localResourceRoots 와 같다). 밖이면 `/res/denied`.
 *  2. CSP: 패널이 쓴 정책을 **그대로 두고** 세 곳만 바꾼다 — `cspSource`(`https://*.vscode-cdn.net`) → `'self'`,
 *     nonce → 새 nonce(요청마다), `connect-src 'self'` 더하기(주입한 수신부가 fetch · EventSource 를 쓴다).
 *     설계 패널의 `'unsafe-eval'`(3D 뷰어가 쓴다) 같은 나머지 지시는 그대로다. **원래 nonce 와 같은 값**을 단 태그만 새 nonce 로
 *     (V5-18a — 페이지가 보낸 문자열에 섞인 `<script nonce="아무거나">` 는 바꾸지 않으므로 돌지 않는다. VS Code 와 같다).
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
  /** 이 웹뷰를 끼우는 틀의 출처 — 열쇠 · 테마는 이 출처의 부모 창에서 온 postMessage 만 받는다 */
  frameOrigin: string;
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

/** CSP 정책의 원래 nonce 값들(`'nonce-…'`) */
export function cspNonces(policy: string): string[] {
  return [...policy.matchAll(/'nonce-([^']*)'/g)].map(m => m[1]);
}

/**
 * 수신부(웹뷰 안에서 app.js 보다 먼저 돈다). 평범한 ES2017 로 쓴다.
 *  - 웹뷰 열쇠: 부모(틀, `cfg.frameOrigin`)에게 `need-key` 를 postMessage 로 묻고, 부모가 준 열쇠로만 통로를 연다 — `out` 은
 *    `?k=`, `in` 은 `X-StCFSD-Webview-Key` 머리. 웹뷰는 틀과 다른 출처라 틀의 쓰기 열쇠 · 문서에 닿지 않는다(V5-04 · V5-18).
 *  - `acquireVsCodeApi()` → `{postMessage, getState, setState}`(VS Code 와 같이 한 번만). postMessage 는 묶어서
 *    `POST /api/wv/<id>/in?conn=` 로, 받는 것은 `GET /api/wv/<id>/out`(SSE)에서 표준 `message` 사건으로.
 *  - 부모가 보내는 것(그 출처 · 그 창에서 온 것만, app.js 에는 넘기지 않는다): `key` · `theme`(새로 고침 없이 테마 — V5-03) ·
 *    `click`(정해 둔 단추 둘 — 새 화면의 「열기」 · 「저장」). 부모에게 보내는 것: `need-key`, F2 키(새 화면의 편집 상태).
 *  - 새로 고침 · 다시 싣기 앞(`pagehide`): 페이지 자신의 저장 길로 설계 탭 입력을 모은다 — 페이지에 `collectDesignData` 를
 *    호스트가 보낸 것처럼 넣고, 페이지가 돌려주는 `designDataCollected` 를 호스트로 보내지 않고 이 탭의 sessionStorage 에 둔다.
 *    다시 뜬 페이지는 다시 보내기를 마친 뒤 그것을 `restoreDesignInputs`(파일을 열 때와 같은 길)로 되돌린다(V5-03).
 *    다만 모은 때와 같은 파일일 때만 — 마지막 `resultsCleared` · `restoreDesignInputs` 의 순서 번호(SSE 의 id, 호스트가 다른 파일을 열 때마다
 *    새로 생긴다)를 함께 두고 다시 보내기의 것과 비교한다. 다르면 버리고 상태 줄에 알린다(V5b-02). 10 분 넘은 것도 버린다.
 *  - 연결이 끊겼다 다시 붙으면(두 번째 hello) 페이지를 다시 읽는다 — 다리가 지금 상태를 다시 보낸다(다시 보내기).
 *  - 다른 연결이 이 웹뷰를 가져가면(`superseded`) 멈추고 `<html data-stcfsd-bridge="superseded">` 로 표시한다.
 */
function clientScript(cfg: Record<string, unknown>): string {
  return `(function(){
"use strict";
var cfg=${JSON.stringify(cfg).replace(/</g, '\\u003c')};
var base='/api/wv/'+encodeURIComponent(cfg.id);
var conn=null,open=false,ever=false,dead=false,sending=false,outQ=[],key=null,es=null,capturing=false,replayDone=false;
var fileSeq=null,PRESERVE_MS=600000;
var html=document.documentElement;
var preserveKey='stcfsd.wv.preserve.'+cfg.viewType;
function toParent(m){try{if(window.parent&&window.parent!==window){window.parent.postMessage(m,cfg.frameOrigin);}}catch(e){}}
function send(){
  if(!open||dead||sending||!key||outQ.length===0){return;}
  sending=true;
  var body='['+outQ.join(',')+']';outQ=[];
  fetch(base+'/in?conn='+encodeURIComponent(conn),{method:'POST',headers:{'Content-Type':'application/json','X-StCFSD-Webview-Key':key},body:body,credentials:'same-origin'})
    .then(function(r){if(r.status===409){stop('superseded');}})
    .catch(function(e){console.warn('[stcfsd-bridge] 보내기 실패 — 이 묶음은 버린다',e);})
    .then(function(){sending=false;send();});
}
function stop(why){dead=true;open=false;try{if(es){es.close();}}catch(e){}html.setAttribute('data-stcfsd-bridge',why);}
var memState;var stateKey='stcfsd.wv.state.'+cfg.viewType;var acquired=false;
window.acquireVsCodeApi=function(){
  if(acquired){throw new Error('An instance of the VS Code API has already been acquired');}
  acquired=true;
  return Object.freeze({
    postMessage:function(m){
      if(capturing&&m&&m.command==='designDataCollected'){try{sessionStorage.setItem(preserveKey,JSON.stringify({at:Date.now(),fileSeq:fileSeq,data:m.data}));}catch(e){}return;}
      outQ.push(JSON.stringify(m===undefined?null:m));send();
    },
    getState:function(){try{var s=sessionStorage.getItem(stateKey);return s==null?memState:JSON.parse(s);}catch(e){return memState;}},
    setState:function(s){memState=s;try{sessionStorage.setItem(stateKey,JSON.stringify(s));}catch(e){}return s;}
  });
};
function toPage(msg){window.dispatchEvent(new MessageEvent('message',{data:msg,origin:location.origin}));}
function applyTheme(t){
  var th=cfg.themes&&cfg.themes[t];if(!th){return;}
  var st=document.getElementById('stcfsd-bridge-theme');if(st){st.textContent=th.css;}
  var b=document.body;if(b){b.classList.remove('vscode-dark','vscode-light','vscode-high-contrast');b.classList.add(th.cls);b.setAttribute('data-vscode-theme-kind',th.cls);}
  html.setAttribute('data-stcfsd-theme',t);
}
var CLICKABLE={'btn-file-open':1,'btn-file-save':1};
window.addEventListener('message',function(e){
  var d=e.data;
  if(!(d&&d.stcfsdBridge===1)){return;}
  e.stopImmediatePropagation();
  if(e.source!==window.parent||e.origin!==cfg.frameOrigin){return;}
  if(d.type==='key'&&typeof d.key==='string'){if(!key){key=d.key;connect();}}
  else if(d.type==='theme'){applyTheme(d.theme);}
  else if(d.type==='click'&&CLICKABLE[d.id]===1){var b=document.getElementById(d.id);if(b){b.click();}}
},true);
document.addEventListener('keydown',function(e){if(e.key==='F2'){toParent({stcfsdBridge:1,type:'keydown',key:'F2'});}});
var received=0;
function connect(){
  es=new EventSource(base+'/out?k='+encodeURIComponent(key));
  es.addEventListener('hello',function(e){
    var d=JSON.parse(e.data);
    if(ever){location.reload();return;}
    ever=true;conn=d.conn;open=true;html.setAttribute('data-stcfsd-bridge','connected');send();
  });
  es.addEventListener('superseded',function(){stop('superseded');});
  es.addEventListener('replayed',function(e){
    html.setAttribute('data-stcfsd-replayed',e.data);
    replayDone=true;
    var saved=null;try{saved=JSON.parse(sessionStorage.getItem(preserveKey)||'null');sessionStorage.removeItem(preserveKey);}catch(err){saved=null;}
    if(saved&&saved.data){
      // V5b-02 · 모은 입력은 모은 때의 파일에만 되돌린다 — 그사이 호스트가 다른 파일을 열었으면(다시 보내기의 마지막
      // resultsCleared · restoreDesignInputs 의 순서 번호가 다르면) 버리고 상태 줄에 알린다. 오래된 것(10 분)도 버린다.
      var why=saved.fileSeq!==fileSeq?'dropped-other-file':(!(Date.now()-Number(saved.at)<PRESERVE_MS)?'dropped-stale':null);
      setTimeout(function(){
        if(why){
          html.setAttribute('data-stcfsd-preserved',why);
          var text=why==='dropped-other-file'
            ?'새로 고침하는 동안 다른 파일이 열려, 이 화면에만 있던 설계 탭 입력을 되살리지 않았습니다 — 지금 파일의 값입니다.'
            :'새로 고침 전의 설계 탭 입력이 오래되어 되살리지 않았습니다.';
          // 페이지의 상태 줄은 페이지가 곧 다시 쓰므로, 다리의 알림 줄을 따로 맨 위에 둔다(누르면 닫힘)
          var n=document.createElement('div');n.id='stcfsd-bridge-notice';n.setAttribute('role','status');n.textContent=text+'  ✕';
          n.style.cssText='position:sticky;top:0;z-index:2147483646;padding:6px 10px;font-size:12px;cursor:pointer;'
            +'background:var(--vscode-inputValidation-warningBackground,#5a4a1a);color:var(--vscode-foreground,#eee);border-bottom:1px solid var(--vscode-inputValidation-warningBorder,#b89500)';
          n.addEventListener('click',function(){n.remove();});
          if(document.body){document.body.insertBefore(n,document.body.firstChild);}
          var st=document.getElementById('status-message');if(st){st.textContent=text;}
          return;
        }
        var inputs=saved.data.__stcfsd_collect===2?saved.data.designInputs:saved.data;
        if(inputs){toPage({command:'restoreDesignInputs',data:inputs});html.setAttribute('data-stcfsd-preserved','restored');}
      },50);
    }
  });
  es.onmessage=function(e){
    var msg;try{msg=JSON.parse(e.data);}catch(err){return;}
    received++;
    if(msg&&(msg.command==='resultsCleared'||msg.command==='restoreDesignInputs')){fileSeq=e.lastEventId||null;}
    toPage(msg);
  };
  es.onerror=function(){if(!dead){open=false;}};
}
window.addEventListener('pagehide',function(){
  if(!replayDone||dead){return;}
  capturing=true;
  try{toPage({command:'collectDesignData'});}catch(e){}
  capturing=false;
});
if(window.parent===window){html.setAttribute('data-stcfsd-bridge','no-frame');}
else{html.setAttribute('data-stcfsd-bridge','waiting-key');toParent({stcfsdBridge:1,type:'need-key',id:cfg.id});}
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
  const original = new Set(m ? cspNonces(m[2]) : []);
  const csp = m ? rewriteCsp(m[2], nonce)
    : `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`;
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  out = m ? out.replace(metaRe, cspMeta) : out.replace(/<head[^>]*>/i, h => `${h}\n${cspMeta}`);
  // 원래 nonce 와 같은 값을 단 태그만 새 nonce 로(V5-18a). 다른 값은 그대로 — 새 정책에 맞지 않아 돌지 않는다.
  out = out.replace(/\snonce=(["'])([^"']*)\1/gi, (all: string, _q: string, v: string) => (original.has(v) ? ` nonce="${nonce}"` : all));
  const cfg = {
    id: o.webviewId, viewType: o.viewType, frameOrigin: o.frameOrigin,
    themes: { dark: { css: themeCss('dark'), cls: themeBodyClass('dark') }, light: { css: themeCss('light'), cls: themeBodyClass('light') } },
  };
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
