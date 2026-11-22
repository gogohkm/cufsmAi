/*
 * 틀(`/`) — 설계 패널 iframe 을 창 가득 띄우고, 호스트의 물음 · 알림 · 진행을 그린다. 화면 다리의 이벤트 흐름
 * (`/api/events`)만 듣고, 답은 `POST /api/platform/answer` 로 보낸다. 계산 · 판정은 하지 않는다.
 *
 *  - 물음(platform:question): 단추 있는 알림 · modal 확인 · 고르기 · 입력 · 열기/저장. 한 번에 하나씩 그린다.
 *    열기/저장은 경로 칸 하나다 — 처음 값은 다리가 준 `suggestedPath`(문서 폴더 아래 StCFSD\). 사용자가 확인을 눌러야
 *    그 경로를 호스트가 읽거나 쓴다. S3 에서는 다리가 OS 대화상자로 바꾸고 이 칸은 뜨지 않는다.
 *  - 단순 알림(platform:notify)은 오른쪽 아래 풍선. 진행(platform:progress)은 제목 표시줄.
 *  - 좌굴 보고서 같은 두 번째 웹뷰(webview:created)는 오른쪽 칸에 띄우고, ✕ 를 누르면 호스트에 닫기를 보낸다.
 *  - 제목 표시줄: 지금 파일 이름(file:current), Claude 연결 상태(`/api/claude/status`, 10 초마다).
 *  - 쓰기(POST · `/api/wv-key`)에는 `X-StCFSD-Key` 를 붙인다 — 브라우저는 `?t=` 교환이 이 탭의 sessionStorage 에 둔 열쇠,
 *    Electron 은 주 프로세스가 붙이므로 페이지에는 없다(V5-04). 끼운 웹뷰는 다른 출처(웹뷰 서버)라 이 열쇠에 닿지 않는다.
 *  - 웹뷰 열쇠: 끼운 웹뷰가 postMessage 로 `need-key` 를 물으면, 그것이 이 틀의 iframe(설계 · 보고서)이고 웹뷰 서버 출처일 때만
 *    `/api/wv-key` 로 받은 열쇠를 그 창에 건넨다. 테마는 새로 고침 없이 iframe 에 postMessage 로(V5-03).
 * 평범한 ES2017 로 쓴다(빌드 없이 다리가 그대로 내준다).
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var theme = params.get('theme') === 'light' ? 'light' : (params.get('theme') === 'dark' ? 'dark' : null);
  var $ = function (id) { return document.getElementById(id); };
  var queue = [];
  var current = null;
  var designerId = null;
  var sideId = null;
  var progress = {};
  var stateObj = null;
  var wvOrigin = null;
  var KEY = null;
  try { KEY = sessionStorage.getItem('stcfsd.bridge.key.' + location.port); } catch (e) { KEY = null; }

  function keyHeaders(h) { if (KEY) { h['X-StCFSD-Key'] = KEY; } return h; }
  function post(url, body) {
    return fetch(url, { method: 'POST', headers: keyHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  }
  // ── 웹뷰 열쇠 — 이 틀의 iframe 에만 ─────────────────────────────
  var wvKey = null;
  var wvKeyWaiters = [];
  var wvKeyAsked = false;
  function withWebviewKey(cb) {
    if (wvKey) { cb(wvKey); return; }
    wvKeyWaiters.push(cb);
    if (wvKeyAsked) { return; }
    wvKeyAsked = true;
    fetch('/api/wv-key', { headers: keyHeaders({}), credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (r) {
      wvKeyAsked = false;
      if (!r || !r.success) { toast({ severity: 'error', message: '화면 연결 열쇠를 받지 못했다 — 주소를 다시 열어 주십시오(' + ((r && r.error) || '') + ')' }); return; }
      wvKey = r.data.key;
      var w = wvKeyWaiters; wvKeyWaiters = [];
      w.forEach(function (f) { f(wvKey); });
    }).catch(function () { wvKeyAsked = false; });
  }
  function ownFrames() { return [$('designer'), $('side-frame')].filter(Boolean); }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.stcfsdBridge !== 1 || !wvOrigin || e.origin !== wvOrigin) { return; }
    var from = ownFrames().filter(function (f) { return f.contentWindow === e.source; })[0];
    if (!from) { return; }
    if (d.type === 'need-key') {
      withWebviewKey(function (k) { try { e.source.postMessage({ stcfsdBridge: 1, type: 'key', key: k }, wvOrigin); } catch (err) { /* 닫힘 */ } });
    }
  });
  function toWebviews(msg) {
    if (!wvOrigin) { return; }
    ownFrames().forEach(function (f) { try { if (f.contentWindow) { f.contentWindow.postMessage(msg, wvOrigin); } } catch (err) { /* 아직 */ } });
  }
  /** 테마 — 틀은 클래스만, 끼운 웹뷰는 postMessage 로(다시 싣지 않는다: 아직 호스트에 가지 않은 설계 탭 입력이 그대로) */
  function setTheme(t) {
    if (t !== 'light' && t !== 'dark') { return; }
    theme = t;
    document.documentElement.classList.toggle('light', theme === 'light');
    toWebviews({ stcfsdBridge: 1, type: 'theme', theme: t });
  }
  function wvUrl(w) { return w.url + (theme ? '?theme=' + theme : ''); }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) { Object.keys(attrs).forEach(function (k) { if (k === 'class') { e.className = attrs[k]; } else { e.setAttribute(k, attrs[k]); } }); }
    if (text !== undefined) { e.textContent = text; }
    return e;
  }

  // ── 상태 ──────────────────────────────────────────────────────────
  function applyState(s) {
    stateObj = s;
    wvOrigin = s.webviewOrigin || null;
    if (!theme) { theme = s.theme === 'light' ? 'light' : 'dark'; }
    document.documentElement.classList.toggle('light', theme === 'light');
    setFile(s.currentFile, s.currentName);
    var designer = (s.webviews || []).filter(function (w) { return w.id === s.designer; })[0];
    if (designer && designerId !== designer.id) {
      designerId = designer.id;
      $('designer').src = wvUrl(designer);
    }
    (s.webviews || []).forEach(function (w) { if (w.id !== s.designer) { showSide(w); } });
    ((s.platform && s.platform.pending) || []).forEach(function (q) { enqueue(q); });
    ((s.platform && s.platform.progress) || []).forEach(function (p) { progress[p.id] = p; });
    renderProgress();
  }
  var baseTitle = 'StCFSD';
  function setFile(file, name) {
    $('file-name').textContent = name || '새 단면';
    $('file-name').title = file || '';
    baseTitle = (name ? name + ' — ' : '') + 'StCFSD';
    renderTitle();
  }
  /** 물음이 떠 있으면 제목 앞에 표시 — 껍데기(S3)는 창을 앞으로 꺼내지 않고 이것과 작업 표시줄 깜빡임으로만 알린다 */
  function renderTitle() {
    document.title = (current ? '● 응답 필요 — ' : '') + baseTitle;
  }
  function renderProgress() {
    var list = Object.keys(progress).map(function (k) { return progress[k]; });
    var p = $('progress');
    if (!list.length) { p.hidden = true; p.textContent = ''; return; }
    var x = list[list.length - 1];
    p.hidden = false;
    p.textContent = '⏳ ' + (x.title || '진행 중') + (x.message ? ' — ' + x.message : '');
  }

  // ── 두 번째 웹뷰(좌굴 보고서) ─────────────────────────────────────
  function showSide(w) {
    sideId = w.id;
    $('side-title').textContent = w.title || w.viewType;
    $('side-frame').src = wvUrl(w);
    $('side').hidden = false;
  }
  function hideSide(id) {
    if (id && id !== sideId) { return; }
    sideId = null;
    $('side').hidden = true;
    $('side-frame').src = 'about:blank';
  }
  $('side-close').addEventListener('click', function () {
    if (!sideId) { return; }
    var id = sideId;
    post('/api/webviews/' + encodeURIComponent(id) + '/close', {}).then(function () { hideSide(id); });
  });

  // ── 알림 풍선 ─────────────────────────────────────────────────────
  function toast(req) {
    var t = el('div', { class: 'toast ' + (req.severity || 'info'), role: 'status' }, req.message + (req.detail ? '\n' + req.detail : ''));
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, req.severity === 'error' ? 15000 : 7000);
  }

  // ── 물음 ──────────────────────────────────────────────────────────
  function enqueue(q) {
    if ((current && current.qid === q.qid) || queue.some(function (x) { return x.qid === q.qid; })) { return; }
    queue.push(q);
    if (!current) { next(); }
  }
  function close(qid) {
    queue = queue.filter(function (x) { return x.qid !== qid; });
    if (current && current.qid === qid) { current = null; $('dialog-host').innerHTML = ''; $('dialog-host').classList.remove('open'); next(); }
    renderTitle();
  }
  function next() {
    if (current || !queue.length) { return; }
    current = queue.shift();
    render(current);
    renderTitle();
  }
  function answer(q, value, errBox) {
    post('/api/platform/answer', { qid: q.qid, answer: value }).then(function (r) {
      if (r && r.success) { close(q.qid); }
      else if (errBox) { errBox.textContent = (r && r.error) || '답을 받지 않았다'; }
    });
  }
  function render(q) {
    var host = $('dialog-host');
    host.innerHTML = '';
    var d = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'data-kind': q.kind, 'data-qid': q.qid });
    var r = q.request || {};
    var err = el('div', { class: 'error' });
    var buttons = el('div', { class: 'buttons' });
    var cancel = function (label) {
      var b = el('button', { type: 'button', 'data-role': 'cancel' }, label || '취소');
      b.addEventListener('click', function () { answer(q, null, err); });
      return b;
    };
    if (q.kind === 'notify') {
      d.appendChild(el('h2', null, r.severity === 'error' ? '오류' : r.severity === 'warning' ? '경고' : '알림'));
      d.appendChild(el('p', { class: 'msg' }, r.message));
      if (r.detail) { d.appendChild(el('pre', { class: 'detail' }, r.detail)); }
      (r.items || []).forEach(function (title, i) {
        var b = el('button', { type: 'button', class: i === 0 ? 'primary' : '', 'data-item': title }, title);
        b.addEventListener('click', function () { answer(q, title, err); });
        buttons.appendChild(b);
      });
      buttons.appendChild(cancel(r.modal ? '닫기' : '닫기'));
    } else if (q.kind === 'pick') {
      d.appendChild(el('h2', null, r.title || r.placeHolder || '고르기'));
      if (r.title && r.placeHolder) { d.appendChild(el('p', { class: 'hint' }, r.placeHolder)); }
      var items = el('div', { class: 'items' });
      var picked = [];
      (r.items || []).forEach(function (it, i) {
        var b = el('button', { type: 'button', 'data-index': String(i) });
        b.appendChild(document.createTextNode(it.label));
        if (it.description) { b.appendChild(el('span', { class: 'desc' }, it.description)); }
        b.addEventListener('click', function () {
          if (!r.canPickMany) { answer(q, i, err); return; }
          var k = picked.indexOf(i);
          if (k >= 0) { picked.splice(k, 1); b.classList.remove('primary'); } else { picked.push(i); b.classList.add('primary'); }
        });
        items.appendChild(b);
      });
      d.appendChild(items);
      if (r.canPickMany) {
        var ok = el('button', { type: 'button', class: 'primary', 'data-role': 'ok' }, '확인');
        ok.addEventListener('click', function () { answer(q, picked.slice().sort(), err); });
        buttons.appendChild(ok);
      }
      buttons.appendChild(cancel());
    } else if (q.kind === 'input' || q.kind === 'fileDialog') {
      var isFile = q.kind === 'fileDialog';
      var title = isFile ? (r.title || (r.kind === 'save' ? (r.saveLabel || '저장') : (r.openLabel || '열기'))) : (r.title || r.prompt || '입력');
      d.appendChild(el('h2', null, title));
      if (!isFile && r.prompt && r.title) { d.appendChild(el('p', { class: 'msg' }, r.prompt)); }
      var input = el('input', { type: 'text', 'data-role': 'value', spellcheck: 'false' });
      input.value = isFile ? (r.suggestedPath || '') : (r.value || '');
      if (!isFile && r.password) { input.type = 'password'; }
      if (r.placeHolder) { input.placeholder = r.placeHolder; }
      d.appendChild(input);
      if (isFile) {
        var exts = r.filters ? Object.keys(r.filters).map(function (k) { return k + ' (' + r.filters[k].map(function (e) { return '.' + e; }).join(', ') + ')'; }).join(' · ') : '';
        d.appendChild(el('p', { class: 'hint' }, (r.kind === 'save' ? '저장할 파일의 전체 경로를 적는다. ' : '열 파일의 전체 경로를 적는다. ')
          + '확인을 누르기 전에는 읽거나 쓰지 않는다.' + (exts ? '\n형식: ' + exts : '')));
      }
      var okBtn = el('button', { type: 'button', class: 'primary', 'data-role': 'ok' }, isFile ? (r.kind === 'save' ? '저장' : '열기') : '확인');
      var submit = function () {
        var v = input.value.trim();
        if (isFile) {
          if (!v) { err.textContent = '경로가 비었다'; return; }
          answer(q, [v], err);
        } else { answer(q, input.value, err); }
      };
      okBtn.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { submit(); } if (e.key === 'Escape') { answer(q, null, err); } });
      buttons.appendChild(okBtn);
      buttons.appendChild(cancel());
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }
    d.appendChild(buttons);
    d.appendChild(err);
    host.appendChild(d);
    host.classList.add('open');
  }

  // ── Claude 연결 상태 · 「연결」 · 「끊기」(S4) ─────────────────────────
  // 쓰기는 사용자가 단추를 누를 때만. 안내 문장 대신 풍선 도움말(title)로 알린다.
  var claudeBusy = false;
  function renderClaude(s) {
    if (!s) { return; }
    var e = $('claude-status');
    e.textContent = s.text;
    e.title = s.tooltip || '';
    e.classList.toggle('connected', s.ui === 'connected');
    e.classList.toggle('warn', s.ui === 'restart-needed' || s.ui === 'registered-elsewhere' || s.ui === 'invalid-config');
    var b = $('claude-action');
    if (s.canDisconnect) {
      b.hidden = false; b.disabled = claudeBusy; b.textContent = '끊기'; b.dataset.op = 'disconnect';
      b.title = 'Claude Desktop 설정에서 이 프로그램의 항목만 지웁니다';
    } else if (s.canConnect || s.ui === 'not-installed' || s.ui === 'invalid-config') {
      b.hidden = false; b.disabled = claudeBusy || !s.canConnect; b.textContent = '연결'; b.dataset.op = 'connect';
      b.title = s.canConnect ? 'Claude Desktop 설정에 이 프로그램을 등록합니다(다른 항목은 그대로, 쓰기 전에 백업)' : (s.tooltip || '');
    } else {
      b.hidden = true;
    }
  }
  function refreshClaude() {
    fetch('/api/claude/status', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (r) { renderClaude(r && r.data); }).catch(function () { /* 다음에 */ });
  }
  $('claude-action').addEventListener('click', function () {
    var op = this.dataset.op;
    if (!op || claudeBusy) { return; }
    claudeBusy = true;
    this.disabled = true;
    post('/api/claude/' + op, {}).then(function (r) {
      claudeBusy = false;
      var d = r && r.data;
      if (!d) { toast({ severity: 'error', message: (r && r.error) || 'Claude 연결을 바꾸지 못했다' }); refreshClaude(); return; }
      toast({ severity: d.result.ok ? 'info' : 'error', message: d.result.message });
      renderClaude(d.status);
    }).catch(function (err) { claudeBusy = false; toast({ severity: 'error', message: String(err) }); refreshClaude(); });
  });
  refreshClaude();
  setInterval(refreshClaude, 10000);

  // ── 이벤트 흐름 ───────────────────────────────────────────────────
  var es = new EventSource('/api/events');
  es.addEventListener('hello', function (e) { applyState(JSON.parse(e.data).state); });
  es.onmessage = function (e) {
    var ev;
    try { ev = JSON.parse(e.data); } catch (err) { return; }
    var d = ev.data || {};
    switch (ev.type) {
      case 'platform:question': enqueue(d); break;
      case 'platform:answered': close(d.qid); break;
      case 'platform:notify': toast(d); break;
      case 'platform:progress':
        if (d.done) { delete progress[d.id]; } else { progress[d.id] = d; }
        renderProgress();
        break;
      case 'webview:created': if (d.id !== designerId) { showSide(d); } break;
      case 'webview:html':
        if (d.id === sideId && stateObj) { $('side-frame').src = $('side-frame').src; }
        break;
      case 'webview:disposed': hideSide(d.id); break;
      case 'file:current': setFile(d.file, d.name); break;
      case 'claude:status': renderClaude(d); break;
      default: break;
    }
  };
  window.__stcfsdFrame = {
    get designerId() { return designerId; },
    get sideId() { return sideId; },
    get dialog() { return current; },
    get queued() { return queue.length; },
    get theme() { return theme; },
    setTheme: setTheme,
  };
})();
