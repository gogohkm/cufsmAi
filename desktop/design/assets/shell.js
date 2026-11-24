/* StCFSD 독립 프로그램 — 화면 템플릿 공통 틀
   각 화면 파일은 가운데(보기 · 표)와 오른쪽 정보 창만 가진다. 이 스크립트가 제목 표시줄(진행 띠 포함), 왼쪽 트리(탭 4개),
   상태 표시줄, 풍선 도움말, 우클릭 메뉴와 가운데 그림(단면 · 좌굴 곡선 · 부재 · 랩 도면)을 그려 넣는다.
   제품 코드가 아니며 동작은 없다. 수치는 모두 예시다(README 참고). StAnal 템플릿의 shell.js 구조를 따랐다. */
(function () {
  'use strict';

  var PROJECT = '물류창고 지붕', CASE = '퍼린 P1';
  var ORDER = [
    ['00-start.html', '00 시작'], ['01-section.html', '01 모델 — 단면'], ['02-buckling.html', '02 결과 — 좌굴 해석'],
    ['03-loads.html', '03 결과 — 하중 해석'], ['04-checks.html', '04 결과 — 부재 검토'], ['05-sheet.html', '05 계산 시트'],
    ['06-connection.html', '06 결과 — 접합부'], ['07-work.html', '07 업무 — 변경'], ['08-documents.html', '08 문서 — 계산서'],
    ['09-edit.html', '09 편집 상태']
  ];
  var UID = 0;
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
  function f(v, d) { return (+v).toFixed(d == null ? 1 : d); }
  function txt(x, y, s, a) { return '<text x="' + f(x) + '" y="' + f(y) + '" ' + (a || '') + '>' + s + '</text>'; }
  function ln(x1, y1, x2, y2, a) { return '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) + '" y2="' + f(y2) + '" ' + (a || '') + '/>'; }
  function arrowHead(x, y, ang, sz, col) {
    var a1 = ang + 2.75, a2 = ang - 2.75;
    return '<path d="M' + f(x) + ' ' + f(y) + ' L' + f(x + sz * Math.cos(a1)) + ' ' + f(y + sz * Math.sin(a1)) + ' L' + f(x + sz * Math.cos(a2)) + ' ' + f(y + sz * Math.sin(a2)) + ' Z" fill="' + col + '"/>';
  }
  /* 치수선 — 양 끝 화살표, 가운데 글자 */
  function dim(x1, y1, x2, y2, label, o) {
    o = o || {};
    var col = o.col || 'var(--dimc)', ang = Math.atan2(y2 - y1, x2 - x1), g = [];
    g.push(ln(x1, y1, x2, y2, 'stroke="' + col + '" stroke-width="1"'));
    g.push(arrowHead(x1, y1, ang + Math.PI, 7, col), arrowHead(x2, y2, ang, 7, col));
    var mx = (x1 + x2) / 2 + (o.dx || 0), my = (y1 + y2) / 2 + (o.dy || 0);
    if (label) {
      var rot = Math.abs(Math.sin(ang)) > 0.9 ? ' transform="rotate(-90 ' + f(mx) + ' ' + f(my) + ')"' : '';
      g.push('<text x="' + f(mx) + '" y="' + f(my) + '" text-anchor="middle" font-size="' + (o.fs || 12) + '" fill="' + (o.tcol || col) + '" font-family="var(--mono)"' + rot + '>' + label + '</text>');
    }
    return g.join('');
  }

  /* ── 단면: 립 Z 200×75×20×2.3 (r 4). 중심선 형상, 절점 37 · 요소 36 ─────────────── */
  var SEC = { H: 200, B: 75, D: 20, t: 2.3, r: 4 };
  function zGeom(t) {
    t = t || SEC.t;
    var h = SEC.H - t, b = SEC.B - t, d = SEC.D - t / 2, rc = SEC.r + t / 2, hy = h / 2, PI = Math.PI;
    var segs = [
      { k: 'l', a: [-b, -hy + d], b: [-b, -hy + rc], n: 2 },
      { k: 'a', c: [-b + rc, -hy + rc], a0: PI, a1: 1.5 * PI, n: 4 },
      { k: 'l', a: [-b + rc, -hy], b: [-rc, -hy], n: 4 },
      { k: 'a', c: [-rc, -hy + rc], a0: 1.5 * PI, a1: 2 * PI, n: 4 },
      { k: 'l', a: [0, -hy + rc], b: [0, hy - rc], n: 8 },
      { k: 'a', c: [rc, hy - rc], a0: PI, a1: PI / 2, n: 4 },
      { k: 'l', a: [rc, hy], b: [b - rc, hy], n: 4 },
      { k: 'a', c: [b - rc, hy - rc], a0: PI / 2, a1: 0, n: 4 },
      { k: 'l', a: [b, hy - rc], b: [b, hy - d], n: 2 }
    ];
    var pts = [], els = [];
    segs.forEach(function (s, si) {
      for (var i = (si === 0 ? 0 : 1); i <= s.n; i++) {
        var u = i / s.n, x, y;
        if (s.k === 'l') { x = s.a[0] + (s.b[0] - s.a[0]) * u; y = s.a[1] + (s.b[1] - s.a[1]) * u; }
        else { var a = s.a0 + (s.a1 - s.a0) * u; x = s.c[0] + rc * Math.cos(a); y = s.c[1] + rc * Math.sin(a); }
        pts.push({ x: x, y: y, inner: s.k === 'a' && i > 0 && i < s.n });
        if (i > 0) { els.push({ i: pts.length - 2, j: pts.length - 1, arc: s.k === 'a' }); }
      }
    });
    return { pts: pts, els: els, h: h, b: b, d: d, rc: rc, hy: hy, t: t };
  }
  /* 모드 형상 — 그림을 위한 근사. 뒤틀림: 윗 플랜지 · 립이 웨브 끝을 축으로 돈다. 국부: 압축 웨브 · 플랜지의 반파. 전체: 강체 회전 */
  function modeShape(g, kind, amp) {
    var piv = g.pts[22], Lw = g.h - 2 * g.rc, yb = -g.hy + g.rc;
    return g.pts.map(function (p, i) {
      var x = p.x, y = p.y, xi;
      if (kind === 'dist') {
        if (i >= 14 && i <= 22) { xi = (y - yb) / Lw; x += amp * Lw * (xi * xi * xi - xi * xi); }
        else if (i > 22) { var dx = x - piv.x, dy = y - piv.y, c = Math.cos(-amp), s = Math.sin(-amp); x = piv.x + dx * c - dy * s; y = piv.y + dx * s + dy * c; }
      } else if (kind === 'local') {
        if (i >= 14 && i <= 22) { xi = (y - yb) / Lw; if (xi > 0.42) { x -= amp * 60 * Math.sin(Math.PI * (xi - 0.42) / 0.58); } }
        else if (i > 22 && i <= 34) { y += amp * 48 * Math.sin(Math.PI * Math.max(0, Math.min(1, x / g.b))); }
      } else if (kind === 'global') {
        var c2 = Math.cos(amp), s2 = Math.sin(amp), x0 = x;
        x = x0 * c2 - y * s2 + amp * 80; y = x0 * s2 + y * c2;
      }
      return { x: x, y: y };
    });
  }
  function secView(o) {
    o = o || {};
    var W = o.w || 640, H = o.h || 520, s = o.s || 2.2, cx = o.cx == null ? W / 2 : o.cx, cy = o.cy == null ? H / 2 : o.cy;
    var g = zGeom(), P = g.pts, out = [], sw = Math.max(1.8, s * g.t);
    function X(x) { return cx + s * x; } function Y(y) { return cy - s * y; }
    function path(pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + f(X(p.x)) + ' ' + f(Y(p.y)); }).join(' '); }
    var steel = o.hiT ? 'var(--mod)' : 'var(--steel)';

    if (o.axes) {
      var th = -20.6 * Math.PI / 180, R = 128 * s / 2.2;
      out.push(ln(X(-g.b - 18), Y(0), X(g.b + 18), Y(0), 'stroke="var(--line)" stroke-dasharray="5 4"'));
      out.push(ln(X(0), Y(g.hy + 16), X(0), Y(-g.hy - 16), 'stroke="var(--line)" stroke-dasharray="5 4"'));
      out.push(ln(cx - R * Math.cos(th), cy + R * Math.sin(th), cx + R * Math.cos(th), cy - R * Math.sin(th), 'stroke="var(--axis)" stroke-width="1" stroke-dasharray="9 3 2 3"'));
      out.push(ln(cx + R * 0.62 * Math.sin(th), cy + R * 0.62 * Math.cos(th), cx - R * 0.62 * Math.sin(th), cy - R * 0.62 * Math.cos(th), 'stroke="var(--axis)" stroke-width="1" stroke-dasharray="9 3 2 3"'));
      out.push(txt(cx + R * Math.cos(th) + 4, cy - R * Math.sin(th) + 12, '1', 'font-size="11" fill="var(--axis)"'));
      out.push(txt(cx - R * 0.62 * Math.sin(th) + 5, cy - R * 0.62 * Math.cos(th) - 2, '2', 'font-size="11" fill="var(--axis)"'));
      out.push(txt(X(g.b + 20), Y(0) + 4, 'x', 'font-size="11" fill="var(--text-faint)"'));
      out.push(txt(X(0) + 5, Y(g.hy + 14), 'y', 'font-size="11" fill="var(--text-faint)"'));
      out.push('<path d="M' + f(cx + 46 * s / 2.2) + ' ' + f(cy) + ' A ' + f(46 * s / 2.2) + ' ' + f(46 * s / 2.2) + ' 0 0 1 ' + f(cx + 46 * s / 2.2 * Math.cos(th)) + ' ' + f(cy - 46 * s / 2.2 * Math.sin(th)) + '" fill="none" stroke="var(--axis)" stroke-width="1"/>');
      out.push(txt(cx + 50 * s / 2.2, cy + 28 * s / 2.2, 'θp 20.6°', 'font-size="11" fill="var(--axis)" font-family="var(--mono)"'));
    }
    if (o.stress) { // 기준 응력 M+ : 위 압축 245, 아래 인장 245 MPa
      var bx = X(-g.b) - 74, wv = 40;
      out.push('<path d="M' + f(bx) + ' ' + f(Y(g.hy)) + ' h' + (-wv) + ' L' + f(bx + wv) + ' ' + f(Y(-g.hy)) + ' h' + (-wv) + ' Z" fill="none"/>');
      out.push('<polygon points="' + f(bx) + ',' + f(Y(g.hy)) + ' ' + f(bx - wv) + ',' + f(Y(g.hy)) + ' ' + f(bx) + ',' + f(cy) + '" fill="var(--ng)" fill-opacity=".22" stroke="var(--ng)" stroke-opacity=".7"/>');
      out.push('<polygon points="' + f(bx) + ',' + f(Y(-g.hy)) + ' ' + f(bx + wv) + ',' + f(Y(-g.hy)) + ' ' + f(bx) + ',' + f(cy) + '" fill="var(--accent)" fill-opacity=".18" stroke="var(--accent)" stroke-opacity=".7"/>');
      out.push(ln(bx, Y(g.hy) - 6, bx, Y(-g.hy) + 6, 'stroke="var(--text-faint)"'));
      out.push(txt(bx - wv, Y(g.hy) - 6, '압축 245', 'font-size="10.5" fill="var(--ng)" font-family="var(--mono)"'));
      out.push(txt(bx + 4, Y(-g.hy) + 16, '인장 245', 'font-size="10.5" fill="var(--accent)" font-family="var(--mono)"'));
      out.push(txt(bx - 8, cy + 4, 'σ', 'font-size="11" fill="var(--text-faint)" text-anchor="end"'));
    }
    // 단면 (변형 전)
    var ghost = !!o.mode;
    out.push('<path d="' + path(P) + '" fill="none" stroke="' + (ghost ? 'var(--ghost)' : steel) + '" stroke-width="' + f(sw) + '" stroke-linejoin="round" stroke-linecap="butt"' + (ghost ? ' opacity=".9"' : '') + '/>');
    if (o.mode) {
      var M = modeShape(g, o.mode, o.amp || (o.mode === 'dist' ? 0.28 : o.mode === 'local' ? 0.12 : 0.13));
      out.push('<path d="' + path(M) + '" fill="none" stroke="var(--modec)" stroke-width="' + f(Math.max(2, sw * 0.75)) + '" stroke-linejoin="round"/>');
      if (!o.mini) {
        M.forEach(function (p, i) { if (!P[i].inner) { out.push('<circle cx="' + f(X(p.x)) + '" cy="' + f(Y(p.y)) + '" r="2" fill="var(--modec)"/>'); } });
        if (o.mode === 'dist') { // 회전축 표시
          out.push('<circle cx="' + f(X(P[22].x)) + '" cy="' + f(Y(P[22].y)) + '" r="5" fill="none" stroke="var(--text-dim)"/>');
        }
      }
    }
    if (o.nodes) {
      P.forEach(function (p, i) {
        var a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1;
        var nx = -ty / L, ny = tx / L, hl = o.hiNode === i + 1;
        out.push('<circle cx="' + f(X(p.x)) + '" cy="' + f(Y(p.y)) + '" r="' + (hl ? 4.5 : 2.6) + '" fill="' + (hl ? 'var(--accent)' : 'var(--bg-view)') + '" stroke="' + (hl ? 'var(--accent)' : 'var(--text)') + '" stroke-width="1.3"/>');
        if (!p.inner && o.nodes === 'label') {
          out.push(txt(X(p.x) + nx * 15, Y(p.y) - ny * 15 + 4, String(i + 1), 'font-size="10.5" text-anchor="middle" fill="' + (hl ? 'var(--accent)' : 'var(--text-dim)') + '" font-family="var(--mono)"'));
        }
      });
      if (o.elems) {
        g.els.forEach(function (e, k) {
          if (e.arc) { return; }
          var a = P[e.i], b = P[e.j], tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1, nx = -ty / L, ny = tx / L;
          out.push(txt(X((a.x + b.x) / 2) - nx * 13, Y((a.y + b.y) / 2) + ny * 13 + 3.5, String(k + 1), 'font-size="9.5" text-anchor="middle" fill="var(--text-faint)" font-style="italic"'));
        });
      }
    }
    if (o.dims) {
      var c = 'var(--dimc)', tO = g.t / 2, yT = g.hy + tO, xL = -tO, xR = g.b + tO, yLip = g.hy - g.d;
      // H
      var hx = X(-g.b - 36);
      out.push(ln(X(xL) - 6, Y(yT), hx - 6, Y(yT), 'stroke="' + c + '" stroke-width=".8"'));
      out.push(ln(X(-g.b - tO) - 6, Y(-yT), hx - 6, Y(-yT), 'stroke="' + c + '" stroke-width=".8"'));
      out.push(dim(hx, Y(yT), hx, Y(-yT), 'H 200', { dx: -9 }));
      // B
      var by = Y(yT + 26);
      out.push(ln(X(xL), Y(yT) - 6, X(xL), by - 6, 'stroke="' + c + '" stroke-width=".8"'));
      out.push(ln(X(xR), Y(yT) - 6, X(xR), by - 6, 'stroke="' + c + '" stroke-width=".8"'));
      out.push(dim(X(xL), by, X(xR), by, 'B 75', { dy: -7 }));
      // D
      var dxx = X(xR + 24);
      out.push(ln(X(xR) + 6, Y(yLip), dxx + 6, Y(yLip), 'stroke="' + c + '" stroke-width=".8"'));
      out.push(ln(X(xR) + 6, Y(yT), dxx + 6, Y(yT), 'stroke="' + c + '" stroke-width=".8"'));
      out.push(dim(dxx, Y(yT), dxx, Y(yLip), 'D 20', { dx: 16 }));
      // t, r
      out.push(ln(X(tO), Y(-34), X(30), Y(-52), 'stroke="' + c + '" stroke-width=".8"') + '<circle cx="' + f(X(tO)) + '" cy="' + f(Y(-34)) + '" r="2" fill="' + c + '"/>');
      out.push(txt(X(31), Y(-52) + 4, 't 2.3', 'font-size="12" fill="' + c + '" font-family="var(--mono)"'));
      var rc0 = [-g.b + g.rc, -g.hy + g.rc], ro = g.rc + tO, ra = 1.25 * Math.PI;
      var rpx = X(rc0[0] + ro * Math.cos(ra)), rpy = Y(rc0[1] + ro * Math.sin(ra));
      out.push(ln(rpx, rpy, rpx - 26, rpy + 26, 'stroke="' + c + '" stroke-width=".8"') + '<circle cx="' + f(rpx) + '" cy="' + f(rpy) + '" r="2" fill="' + c + '"/>');
      out.push(txt(rpx - 30, rpy + 40, 'r 4', 'font-size="12" fill="' + c + '" font-family="var(--mono)"'));
    }
    if (o.axes || o.dims) { out.push('<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="4" fill="none" stroke="var(--axis)"/>' + ln(cx - 7, cy, cx + 7, cy, 'stroke="var(--axis)"') + ln(cx, cy - 7, cx, cy + 7, 'stroke="var(--axis)"')); }
    if (o.hiT) { // 두께 변경 강조 — 웨브 상세 ×20
      var px = X(g.t / 2), py = Y(30), ix = o.inset ? o.inset[0] : X(g.b + 70), iy = o.inset ? o.inset[1] : Y(-20), R2 = 64;
      out.push('<circle cx="' + f(X(0)) + '" cy="' + f(py) + '" r="10" fill="none" stroke="var(--mod)" stroke-width="1.5"/>');
      out.push(ln(X(0) + 10, py + 3, ix - R2, iy, 'stroke="var(--mod)" stroke-width="1" stroke-dasharray="4 3"'));
      out.push('<circle cx="' + f(ix) + '" cy="' + f(iy) + '" r="' + R2 + '" fill="var(--bg-panel)" stroke="var(--mod)" stroke-width="1.5"/>');
      var k = 20, w23 = 2.3 * k, w20 = 2.0 * k;
      out.push('<rect x="' + f(ix - w23 / 2) + '" y="' + f(iy - R2 + 6) + '" width="' + f(w23) + '" height="' + (2 * R2 - 12) + '" fill="var(--mod)" fill-opacity=".28" stroke="var(--mod)" stroke-width="1.4"/>');
      out.push('<rect x="' + f(ix - w23 / 2) + '" y="' + f(iy - R2 + 14) + '" width="' + f(w20) + '" height="' + (2 * R2 - 28) + '" fill="none" stroke="var(--text-dim)" stroke-width="1.2" stroke-dasharray="4 3"/>');
      out.push(txt(ix, iy + R2 + 16, '상세 ×20', 'font-size="10.5" text-anchor="middle" fill="var(--text-faint)"'));
      out.push(txt(ix + w23 / 2 + 6, iy - 6, '2.3', 'font-size="12" fill="var(--mod)" font-family="var(--mono)"'));
      out.push(txt(ix + w23 / 2 + 6, iy + 12, '2.0', 'font-size="11" fill="var(--text-dim)" font-family="var(--mono)"'));
      out.push('<rect x="' + f(X(14)) + '" y="' + f(Y(4) - 15) + '" width="118" height="22" rx="3" fill="var(--bg-panel)" stroke="var(--mod)"/>');
      out.push(txt(X(14) + 9, Y(4), '두께 t 2.0 → 2.3', 'font-size="12" fill="var(--mod)"'));
    }
    var body = o.rot180 ? '<g transform="rotate(180 ' + f(cx) + ' ' + f(cy) + ')">' + out.join('') + '</g>' : out.join(''); // 부휨: 점대칭이라 정휨 모드를 180° 돌린 것
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="단면 보기">' + body + '</svg>';
  }

  /* ── 좌굴 곡선(서명 곡선) — 정휨 M+ 의 하중계수 Mcr/My, 반파장 로그 축. 국부 · 뒤틀림 · 전체 가지를 부드럽게 이은 근사 ── */
  function lfM(L) {
    var xl = L / 130, loc = 1.62 * 0.5 * (1 / (xl * xl) + xl * xl);
    var xd = L / 620, q = 0.5 * (1 / (xd * xd) + xd * xd), dis = 0.85 * (xd < 1 ? q : Math.sqrt(q));
    var glo = 0.25 * Math.pow(6000 / L, 2);
    return Math.pow(Math.pow(loc, -4) + Math.pow(dis, -4) + Math.pow(glo, -4), -0.25);
  }
  function curveView(o) {
    o = o || {};
    var W = o.w || 1100, H = o.h || 380, ml = o.mini ? 34 : 60, mr = o.mini ? 10 : 26, mt = o.mini ? 10 : 26, mb = o.mini ? 24 : 44;
    var x0 = ml, x1 = W - mr, y0 = H - mb, y1 = mt, ymax = 3, id = 'cc' + (++UID), g = [];
    function X(L) { return x0 + (Math.log(L) / Math.LN10 - 1) / 3 * (x1 - x0); }
    function Y(v) { return y0 - v / ymax * (y0 - y1); }
    var fs = o.mini ? 9.5 : 11;
    // 분류 띠
    [[10, 235, '국부'], [235, 1950, '뒤틀림'], [1950, 10000, '전체']].forEach(function (r, i) {
      g.push('<rect x="' + f(X(r[0])) + '" y="' + f(y1) + '" width="' + f(X(r[1]) - X(r[0])) + '" height="' + f(y0 - y1) + '" fill="' + ['var(--clsL)', 'var(--clsD)', 'var(--clsG)'][i] + '" opacity=".07"/>');
      if (!o.mini) { g.push(txt((X(r[0]) + X(r[1])) / 2, y1 + 14, r[2], 'font-size="10.5" fill="var(--text-faint)" text-anchor="middle"')); }
    });
    // 격자
    [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (L) {
      var dec = [10, 100, 1000, 10000].indexOf(L) >= 0;
      g.push(ln(X(L), y1, X(L), y0, 'stroke="var(--line' + (dec ? '' : '-soft') + ')" stroke-width="1"'));
      if (dec || !o.mini) { g.push(txt(X(L), y0 + (o.mini ? 13 : 16), String(L), 'font-size="' + fs + '" text-anchor="middle" fill="var(--text-' + (dec ? 'dim' : 'faint') + ')" font-family="var(--mono)"')); }
    });
    for (var v = 0; v <= ymax + 1e-9; v += 0.5) {
      g.push(ln(x0, Y(v), x1, Y(v), 'stroke="var(--line-soft)"'));
      if (!o.mini || v % 1 === 0) { g.push(txt(x0 - 6, Y(v) + 4, f(v, 1), 'font-size="' + fs + '" text-anchor="end" fill="var(--text-faint)" font-family="var(--mono)"')); }
    }
    g.push(ln(x0, y0, x1, y0, 'stroke="var(--text-faint)"') + ln(x0, y1, x0, y0, 'stroke="var(--text-faint)"'));
    // My 선
    g.push(ln(x0, Y(1), x1, Y(1), 'stroke="var(--text-dim)" stroke-dasharray="6 4"'));
    if (!o.mini) { g.push(txt(x1 - 4, Y(1) - 5, 'My', 'font-size="11" text-anchor="end" fill="var(--text-dim)"')); }
    // 곡선
    var pts = [];
    for (var i = 0; i <= 300; i++) { var L = Math.pow(10, 1 + 3 * i / 300); pts.push(f(X(L)) + ' ' + f(Y(lfM(L)))); }
    g.push('<clipPath id="' + id + '"><rect x="' + x0 + '" y="' + y1 + '" width="' + (x1 - x0) + '" height="' + (y0 - y1) + '"/></clipPath>');
    g.push('<g clip-path="url(#' + id + ')"><path d="M' + pts.join(' L') + '" fill="none" stroke="var(--curve)" stroke-width="' + (o.mini ? 1.6 : 2.2) + '"/>');
    if (!o.mini) { for (var k = 0; k < 60; k++) { var Lk = Math.pow(10, 1 + 3 * k / 59); g.push('<circle cx="' + f(X(Lk)) + '" cy="' + f(Y(lfM(Lk))) + '" r="1.8" fill="var(--curve)"/>'); } }
    g.push('</g>');
    // 극소 마커
    var sel = o.sel || 'dist';
    function mark(L, val, name, key, lx, ly, anchor) {
      var X0 = X(L), Y0 = Y(val), on = key === sel;
      if (on) {
        g.push(ln(X0, Y0, X0, y0, 'stroke="var(--accent)" stroke-dasharray="4 3"'));
        g.push('<circle cx="' + f(X0) + '" cy="' + f(Y0) + '" r="' + (o.mini ? 7 : 12) + '" fill="var(--accent)" opacity=".22"/>');
      }
      g.push('<circle cx="' + f(X0) + '" cy="' + f(Y0) + '" r="' + (on ? (o.mini ? 4 : 6) : (o.mini ? 3 : 4.5)) + '" fill="' + (on ? 'var(--accent)' : 'var(--bg-view)') + '" stroke="' + (on ? 'var(--accent)' : 'var(--text)') + '" stroke-width="1.6"/>');
      if (!o.mini) {
        if (on) {
          var w = name.length * 7.6 + 18;
          g.push('<rect x="' + f(anchor === 'end' ? X0 + lx - w : X0 + lx) + '" y="' + f(Y0 + ly - 16) + '" width="' + f(w) + '" height="23" rx="3" fill="var(--bg-panel)" stroke="var(--accent)"/>');
          g.push(txt(anchor === 'end' ? X0 + lx - w + 9 : X0 + lx + 9, Y0 + ly, name, 'font-size="12" fill="var(--accent)" font-family="var(--mono)"'));
        } else {
          g.push(txt(X0 + lx, Y0 + ly, name, 'font-size="11.5" fill="var(--text-dim)" font-family="var(--mono)" text-anchor="' + anchor + '"'));
        }
      }
    }
    mark(130, 1.62, '국부 1.62 · 130', 'local', 0, 28, 'middle');
    mark(620, 0.85, '뒤틀림 Mcrd/My 0.85 · 620 mm', 'dist', 18, 34, 'start');
    var gx = X(6000), gy = Y(0.25);
    g.push('<path d="M' + f(gx) + ' ' + f(gy - 6) + ' l6 10 h-12 z" fill="var(--bg-view)" stroke="var(--text)" stroke-width="1.4"/>');
    if (!o.mini) {
      g.push(txt(gx - 14, gy + 22, '전체 0.25 · 6000 (스팬)', 'font-size="11.5" fill="var(--text-dim)" text-anchor="end" font-family="var(--mono)"'));
      g.push(txt(X(620), y0 + 30, '620', 'font-size="11" text-anchor="middle" fill="var(--accent)" font-family="var(--mono)"'));
      g.push(txt(x1, y0 + 32, '반파장 (mm)', 'font-size="11" text-anchor="end" fill="var(--text-faint)"'));
      g.push(txt(x0 - 52, y1 - 10, 'Mcr/My', 'font-size="11" fill="var(--text-faint)"'));
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="좌굴 곡선">' + g.join('') + '</svg>';
  }

  /* ── 부재 보기: 3연속 퍼린(스팬 6.0 m × 3, 랩 600/600) · 지배 조합 2 의 M · V · 처짐 ─────────── */
  var BEAM = { L: 18, wu: 3.04, RA: 7.087, MB: -12.2, VB2: 9.12, laps: [[5.4, 6.6], [11.4, 12.6]] };
  function Mx(x) { if (x <= 6) { return BEAM.RA * x - BEAM.wu * x * x / 2; } if (x <= 12) { var a = x - 6; return BEAM.MB + BEAM.VB2 * a - BEAM.wu * a * a / 2; } return Mx(18 - x); }
  function Vx(x) { if (x < 6) { return BEAM.RA - BEAM.wu * x; } if (x < 12) { return BEAM.VB2 - BEAM.wu * (x - 6); } return -(BEAM.RA - BEAM.wu * (18 - x)); }
  var DEFL = (function () { // 사용하중 D+Lr 1.63 kN/m · EI 1051.5 kN·m² (랩 구간 2배) · 스팬별 이중 적분
    var out = [], N = 240, ratio = 1.63 / BEAM.wu, EI = 1051.5;
    [[0, 6], [6, 12], [12, 18]].forEach(function (sp, si) {
      var hstep = (sp[1] - sp[0]) / N, th = 0, y = 0, ys = [0];
      for (var i = 0; i < N; i++) {
        var x = sp[0] + (i + 0.5) * hstep, lap = (x > 5.4 && x < 6.6) || (x > 11.4 && x < 12.6);
        th += Mx(x) * ratio / (lap ? 2 * EI : EI) * hstep; y += th * hstep; ys.push(y);
      }
      for (var j = (si ? 1 : 0); j <= N; j++) { out.push([sp[0] + j * hstep, (ys[j] - ys[N] * j / N) * 1000]); }
    });
    return out;
  }());
  function rcol(r) { return r == null ? 'url(#hatchU)' : r < 0.5 ? 'var(--r1)' : r < 0.75 ? 'var(--r2)' : r < 0.9 ? 'var(--r3)' : r <= 1 ? 'var(--r4)' : r <= 1.25 ? 'var(--r5)' : 'var(--r6)'; }
  var BAND = [[0, 0.3, 0.73], [0.3, 4.66, 0.79], [4.66, 5.4, 0.72], [5.4, 6.6, null], [6.6, 8.01, 0.87], [8.01, 9.99, 0.15], [9.99, 11.4, 0.87], [11.4, 12.6, null], [12.6, 13.34, 0.72], [13.34, 17.7, 0.79], [17.7, 18, 0.73]];
  function memberView(o) {
    o = o || {};
    var W = o.w || 1200, rows = o.rows || ['beam', 'M', 'V', 'D'], x0 = o.mini ? 46 : 78, x1 = W - (o.mini ? 16 : 34), sx = (x1 - x0) / 18, g = [], top = 8;
    var hgt = { beam: o.mini ? 92 : (o.selLabel ? 154 : 134), band: 46, M: o.mini ? 120 : 172, V: o.mini ? 84 : 122, D: 96 };
    function X(x) { return x0 + x * sx; }
    var fs = o.mini ? 10 : 11.5, H = 8 + rows.reduce(function (a, r) { return a + hgt[r]; }, 0) + 6;
    g.push('<defs><pattern id="hatchU" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--bg-view)"/><line x1="0" y1="0" x2="0" y2="7" stroke="var(--unchk)" stroke-width="2.4"/></pattern></defs>');
    var selA = o.sel ? o.sel[0] : null, selB = o.sel ? o.sel[1] : null;
    if (o.sel) { g.push('<rect x="' + f(X(selA)) + '" y="4" width="' + f(X(selB) - X(selA)) + '" height="' + (H - 8) + '" fill="var(--accent)" opacity=".08"/>'); }
    // 랩 끝 · 지점 세로선
    var lapx = [5.4, 6.6, 11.4, 12.6];
    function vlines(yA, yB) {
      lapx.forEach(function (x) { g.push(ln(X(x), yA, X(x), yB, 'stroke="var(--lapc)" stroke-dasharray="3 4" stroke-width="1"')); });
      [0, 6, 12, 18].forEach(function (x) { g.push(ln(X(x), yA, X(x), yB, 'stroke="var(--line)" stroke-width="1"')); });
    }
    rows.forEach(function (r) {
      var h = hgt[r], yA = top, yB = top + h;
      if (r === 'beam') {
        var yb = top + (o.mini ? 52 : (o.selLabel ? 86 : 66));
        // 하중
        var ya = yb - (o.mini ? 30 : 38);
        g.push(ln(X(0), ya, X(18), ya, 'stroke="var(--loadc)" stroke-width="1.2"'));
        for (var x = 0; x <= 18.001; x += (o.mini ? 1 : 0.5)) { g.push('<path d="M' + f(X(x)) + ' ' + f(ya) + ' V' + f(yb - 5) + ' m-3.5 -6 l3.5 6 l3.5 -6" fill="none" stroke="var(--loadc)" stroke-width="1.1"/>'); }
        if (!o.mini) { g.push(txt(X(0), ya - 9, W < 800 ? 'wu 3.04 kN/m · 조합 2' : 'wu 3.04 kN/m · 조합 2  1.2D + 1.6Lr + 0.5W↓', 'font-size="12" fill="var(--loadc)"')); }
        // 보와 랩
        g.push(ln(X(0), yb, X(18), yb, 'stroke="var(--steel)" stroke-width="3.2"'));
        BEAM.laps.forEach(function (lp) {
          g.push(ln(X(lp[0]), yb + 5, X(lp[1]), yb + 5, 'stroke="var(--steel)" stroke-width="3.2"'));
          [lp[0] + 0.05, lp[1] - 0.05].forEach(function (bx) { g.push('<circle cx="' + f(X(bx)) + '" cy="' + f(yb + 2.5) + '" r="2.4" fill="var(--bg-view)" stroke="var(--text)" stroke-width="1"/>'); });
          if (!o.mini) { g.push(txt(X((lp[0] + lp[1]) / 2), yb + 56, '랩 600 | 600', 'font-size="10.5" text-anchor="middle" fill="var(--lapc)"')); }
        });
        // 지점
        ['A', 'B', 'C', 'D'].forEach(function (nm, i) {
          var sxp = X(i * 6), sy = yb + 6;
          g.push('<path d="M' + f(sxp) + ' ' + f(sy) + ' l-8 13 h16 z" fill="none" stroke="var(--warn)" stroke-width="1.5"/>');
          if (i > 0 && i < 3) { g.push(ln(sxp - 10, sy + 16, sxp + 10, sy + 16, 'stroke="var(--warn)" stroke-width="1.5"')); }
          g.push(txt(sxp + (i === 3 ? -14 : 14), sy + 13, nm, 'font-size="' + fs + '" fill="var(--text-dim)" text-anchor="middle"'));
        });
        if (!o.mini) {
          for (var sp = 0; sp < 3; sp++) { g.push(dim(X(sp * 6) + 1, yb + 36, X(sp * 6 + 6) - 1, yb + 36, '6.0 m', { dy: -5, fs: 11.5 })); }
        }
        if (o.selLabel && !o.mini) {
          g.push('<rect x="' + f(X(selA) + 6) + '" y="' + f(ya - 30) + '" width="' + (o.selLabel.length * 8.4 + 14) + '" height="21" rx="3" fill="var(--bg-panel)" stroke="var(--accent)"/>');
          g.push(txt(X(selA) + 13, ya - 15, o.selLabel, 'font-size="11.5" fill="var(--accent)"'));
          g.push(ln(X(selA), ya - 26, X(selA), yb, 'stroke="var(--accent)" stroke-width="1.4"'));
        }
      } else if (r === 'band') {
        var y = top + 14, bh = 20;
        g.push(txt(8, y + 14, '판정비', 'font-size="' + fs + '" fill="var(--text-dim)"'));
        BAND.forEach(function (b) {
          var on = o.sel && Math.abs(b[0] - selA) < 1e-6;
          g.push('<rect x="' + f(X(b[0])) + '" y="' + y + '" width="' + f(X(b[1]) - X(b[0])) + '" height="' + bh + '" fill="' + rcol(b[2]) + '"' + (b[2] == null ? '' : ' fill-opacity="' + (o.sel && !on ? '.55' : '.9') + '"') + ' stroke="var(--bg-view)" stroke-width="1"/>');
          if (on) { g.push('<rect x="' + f(X(b[0]) - 1) + '" y="' + (y - 3) + '" width="' + f(X(b[1]) - X(b[0]) + 2) + '" height="' + (bh + 6) + '" fill="none" stroke="var(--accent)" stroke-width="2.2"/>'); }
          if (b[2] != null && X(b[1]) - X(b[0]) > 34) { g.push(txt((X(b[0]) + X(b[1])) / 2, y + 14.5, f(b[2], 2), 'font-size="11" text-anchor="middle" fill="#0d0f12" font-family="var(--mono)" font-weight="600"')); }
        });
      } else if (r === 'M' || r === 'V') {
        var yc = top + h * (r === 'M' ? 0.52 : 0.5), amp = (r === 'M' ? (o.mini ? 46 : 66) / 12.2 : (o.mini ? 30 : 44) / 11.15), fn = r === 'M' ? Mx : Vx, col = r === 'M' ? 'var(--mcol)' : 'var(--vcol)';
        vlines(top + 4, yB - 4);
        g.push(txt(8, top + 16, r === 'M' ? 'M  kN·m' : 'V  kN', 'font-size="' + fs + '" fill="var(--text-dim)"'));
        var pp = ['M' + f(X(0)) + ' ' + f(yc)], N = 360;
        for (var i2 = 0; i2 <= N; i2++) { var xx = 18 * i2 / N; if (r === 'V' && (Math.abs(xx - 6) < 1e-9 || Math.abs(xx - 12) < 1e-9)) { pp.push('L' + f(X(xx)) + ' ' + f(yc - Vx(xx - 1e-6) * amp)); } pp.push('L' + f(X(xx)) + ' ' + f(yc - fn(xx) * amp)); }
        pp.push('L' + f(X(18)) + ' ' + f(yc) + ' Z');
        g.push('<path d="' + pp.join(' ') + '" fill="' + col + '" fill-opacity=".16" stroke="' + col + '" stroke-width="1.8" stroke-linejoin="round"/>');
        g.push(ln(X(0), yc, X(18), yc, 'stroke="var(--text-faint)" stroke-width="1"'));
        var labs = r === 'M'
          ? [[2.33, 8.26, 0, -8], [6, -12.2, 0, 17], [5.4, -6.05, -24, 4], [6.6, -7.28, 26, 4], [9, 1.48, 0, -8], [12, -12.2, 0, 17], [15.67, 8.26, 0, -8]]
          : [[0, 7.09, 16, -4], [6, -11.15, -22, 14], [6, 9.12, 20, -2], [12, -9.12, -20, 12], [12, 11.15, 22, -2], [18, -7.09, -16, 14]];
        labs.forEach(function (lb) {
          var on = o.sel && r === 'M' && Math.abs(lb[0] - selA) < 1e-6;
          g.push(txt(X(lb[0]) + lb[2] * (o.mini ? 0.7 : 1), yc - lb[1] * amp + lb[3], (lb[1] > 0 ? '+' : '−') + f(Math.abs(lb[1]), 2), 'font-size="' + (o.mini ? 9.5 : 11) + '" text-anchor="middle" fill="' + (on ? 'var(--accent)' : 'var(--text)') + '" font-family="var(--mono)"' + (on ? ' font-weight="700"' : '')));
        });
        if (r === 'M') {
          [4.66, 8.01, 9.99, 13.34].forEach(function (xi) { g.push('<circle cx="' + f(X(xi)) + '" cy="' + f(yc) + '" r="3.2" fill="var(--bg-view)" stroke="var(--mcol)" stroke-width="1.4"/>'); });
          if (!o.mini && o.dims !== false) {
            var yd = yc - 24;
            g.push(dim(X(4.66), yd, X(6), yd, '1.34', { dy: -5, fs: 10.5, col: 'var(--warn)' }));
            g.push(dim(X(6), yd, X(8.01), yd, 'Ly 2.01 m · Cb 1.94', { dy: -5, fs: 10.5, col: 'var(--warn)' }));
            g.push(txt(X(4.66), yc + 18, '변곡점', 'font-size="10" text-anchor="middle" fill="var(--text-faint)"'));
            g.push(txt(X(8.01), yc + 18, '변곡점', 'font-size="10" text-anchor="middle" fill="var(--text-faint)"'));
            g.push(txt(X(6.6), top + 14, '랩 끝', 'font-size="10" text-anchor="middle" fill="var(--lapc)"'));
            g.push(txt(X(5.4), top + 14, '랩 끝', 'font-size="10" text-anchor="middle" fill="var(--lapc)"'));
          }
          if (o.sel) { g.push('<circle cx="' + f(X(selA)) + '" cy="' + f(yc - Mx(selA) * amp) + '" r="6" fill="var(--accent)" stroke="var(--bg-view)" stroke-width="2"/>'); }
        }
      } else if (r === 'D') {
        var yz = top + 26, ampD = 46 / 12.6;
        vlines(top + 4, yB - 4);
        g.push(txt(8, top + 16, 'δ  mm', 'font-size="' + fs + '" fill="var(--text-dim)"'));
        g.push(ln(X(0), yz, X(18), yz, 'stroke="var(--text-faint)"'));
        g.push('<path d="M' + DEFL.map(function (p) { return f(X(p[0])) + ' ' + f(yz - p[1] * ampD); }).join(' L') + '" fill="none" stroke="var(--dcol)" stroke-width="1.8"/>');
        g.push(txt(X(2.63), yz + 12.6 * ampD + 16, '12.6 · L/475', 'font-size="11" text-anchor="middle" fill="var(--text)" font-family="var(--mono)"'));
        g.push(txt(X(15.37), yz + 12.6 * ampD + 16, '12.6', 'font-size="11" text-anchor="middle" fill="var(--text)" font-family="var(--mono)"'));
        g.push(txt(X(18), top + 16, '사용하중 D + Lr', 'font-size="10.5" text-anchor="end" fill="var(--text-faint)"'));
      }
      top += h;
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="부재 보기">' + g.join('') + '</svg>';
  }

  /* ── 랩 접합 도면 P1-B: 측면도(지점 B ± 900) · Cut A-A · 패스너 배치 ─────────── */
  function lapView(o) {
    o = o || {};
    var W = o.w || 1200, H = o.h || 860, g = [], s = 0.6, cx = W / 2, cy = 190;
    function X(x) { return cx + s * x; } function Y(y) { return cy - s * y; }
    var st = 'var(--steel)', st2 = 'var(--steel2)';
    g.push(txt(24, 30, '측면도', 'font-size="13" fill="var(--text)" font-weight="600"'));
    g.push(txt(84, 30, '지점 B · 축척 1:' + Math.round(1 / s * 3.78 * 10) / 10, 'font-size="11" fill="var(--text-faint)"'));
    // 서까래(지점) — 잘린 H형강
    var ry = Y(-100);
    g.push('<rect x="' + f(X(-75)) + '" y="' + f(ry) + '" width="' + f(150 * s) + '" height="9" fill="var(--bg-raise)" stroke="var(--text-dim)"/>');
    g.push('<rect x="' + f(X(-4)) + '" y="' + f(ry + 9) + '" width="' + f(8 * s) + '" height="70" fill="var(--bg-raise)" stroke="var(--text-dim)"/>');
    g.push('<path d="M' + f(X(-75) - 6) + ' ' + f(ry + 79) + ' l10 -6 l8 12 l10 -6 h' + f(150 * s - 20) + '" fill="none" stroke="var(--text-faint)"/>');
    g.push(txt(X(80), ry + 46, '서까래', 'font-size="11" fill="var(--text-faint)"'));
    // 클리트
    g.push('<rect x="' + f(X(6)) + '" y="' + f(Y(40)) + '" width="' + f(8 * s + 2) + '" height="' + f(140 * s) + '" fill="var(--bg-raise)" stroke="var(--text-dim)"/>');
    // 퍼린 1 (스팬 1 쪽, 왼쪽에서 +600 까지) · 퍼린 2 (−600 부터 오른쪽)
    function purlin(xa, xb, col, dy) {
      var yt = Y(100 + dy), yb = Y(-100 + dy);
      g.push('<rect x="' + f(X(xa)) + '" y="' + f(yt) + '" width="' + f((xb - xa) * s) + '" height="' + f(200 * s) + '" fill="' + col + '" fill-opacity=".07" stroke="' + col + '" stroke-width="1.6"/>');
      g.push(ln(X(xa), Y(80 + dy), X(xb), Y(80 + dy), 'stroke="' + col + '" stroke-width="1" stroke-dasharray="7 4"'));
      g.push(ln(X(xa), Y(-80 + dy), X(xb), Y(-80 + dy), 'stroke="' + col + '" stroke-width="1" stroke-dasharray="7 4"'));
    }
    purlin(-900, 600, st, 0);
    purlin(-600, 900, st2, -2.3);
    g.push('<rect x="' + f(X(-600)) + '" y="' + f(Y(100)) + '" width="' + f(1200 * s) + '" height="' + f(200 * s) + '" fill="var(--lapc)" fill-opacity=".07"/>');
    // 끊김 표시
    [[-900, st], [900, st2]].forEach(function (b) {
      var bx = X(b[0]); g.push('<path d="M' + f(bx) + ' ' + f(Y(108)) + ' l-6 30 l12 10 l-10 30 l8 10 l-4 50" fill="none" stroke="var(--text-faint)" stroke-width="1"/>');
    });
    // 볼트 — 랩 끝(±564, ±60) · 클리트(10, −10 / −70)
    function bolt(x, y, col) { g.push('<circle cx="' + f(X(x)) + '" cy="' + f(Y(y)) + '" r="' + f(7 * s + 2) + '" fill="var(--bg-view)" stroke="' + (col || 'var(--text)') + '" stroke-width="1.6"/>' + ln(X(x) - 7, Y(y), X(x) + 7, Y(y), 'stroke="' + (col || 'var(--text)') + '"') + ln(X(x), Y(y) - 7, X(x), Y(y) + 7, 'stroke="' + (col || 'var(--text)') + '"')); }
    [-564, 564].forEach(function (x) { bolt(x, 60, 'var(--accent)'); bolt(x, -60, 'var(--accent)'); });
    bolt(10, 10); bolt(10, -50);
    // 자체 가정 힘 분배 — 랩 끝 볼트에 짝힘
    [[-564, 1], [564, -1]].forEach(function (b) {
      [[60, 1], [-60, -1]].forEach(function (yy) {
        var x = X(b[0]), y = Y(yy[0]), d = 30 * b[1] * yy[1];
        g.push(ln(x, y, x + d, y, 'stroke="var(--warn)" stroke-width="2"') + arrowHead(x + d, y, d > 0 ? 0 : Math.PI, 8, 'var(--warn)'));
      });
    });
    g.push(txt(X(564) + 40, Y(60) - 10, '16.5 kN', 'font-size="11.5" fill="var(--warn)" font-family="var(--mono)"'));
    g.push('<rect x="' + f(X(564) + 38) + '" y="' + f(Y(60) + 2) + '" width="64" height="18" rx="3" fill="none" stroke="var(--warn)"/>');
    g.push(txt(X(564) + 45, Y(60) + 15, '자체 가정', 'font-size="10.5" fill="var(--warn)"'));
    // 중심선 · 지점 이름
    g.push(ln(X(0), Y(160), X(0), Y(-190), 'stroke="var(--text-faint)" stroke-dasharray="14 4 3 4"'));
    g.push(txt(X(0) + 8, Y(-200), '지점 B', 'font-size="11.5" fill="var(--text-dim)"'));
    // 치수
    var dy1 = Y(150);
    [-600, 0, 600].forEach(function (x) { g.push(ln(X(x), Y(104), X(x), dy1 - 6, 'stroke="var(--dimc)" stroke-width=".8"')); });
    g.push(dim(X(-600), dy1, X(0), dy1, '600', { dy: -6 }), dim(X(0), dy1, X(600), dy1, '600', { dy: -6 }));
    g.push(dim(X(-600), dy1 - 30, X(600), dy1 - 30, '랩 1200', { dy: -6 }));
    g.push(ln(X(-600), dy1 - 6, X(-600), dy1 - 36, 'stroke="var(--dimc)" stroke-width=".8"') + ln(X(600), dy1 - 6, X(600), dy1 - 36, 'stroke="var(--dimc)" stroke-width=".8"'));
    var dxr = X(900) + 26;
    g.push(ln(X(900) + 4, Y(100), dxr + 6, Y(100), 'stroke="var(--dimc)" stroke-width=".8"') + ln(X(900) + 4, Y(-100), dxr + 6, Y(-100), 'stroke="var(--dimc)" stroke-width=".8"'));
    g.push(dim(dxr, Y(100), dxr, Y(-100), '200', { dx: 14 }));
    g.push(dim(X(564), Y(-118), X(600), Y(-118), '', {}) + txt(X(582), Y(-118) + 16, '36', 'font-size="11" text-anchor="middle" fill="var(--dimc)" font-family="var(--mono)"'));
    g.push(ln(X(564), Y(-60) + 8, X(564), Y(-118) - 4, 'stroke="var(--dimc)" stroke-width=".8"'));
    g.push(dim(X(-640), Y(60), X(-640), Y(-60), '120', { dx: -12 }));
    g.push(ln(X(-564) - 8, Y(60), X(-640) - 4, Y(60), 'stroke="var(--dimc)" stroke-width=".8"') + ln(X(-564) - 8, Y(-60), X(-640) - 4, Y(-60), 'stroke="var(--dimc)" stroke-width=".8"'));
    // 이름표
    g.push(txt(X(-880), Y(118), 'P1-1  Z-200×75×20×2.3  (스팬 1)', 'font-size="11.5" fill="var(--steel)"'));
    g.push(txt(X(880), Y(118), 'P1-2  (스팬 2)', 'font-size="11.5" fill="var(--steel2)" text-anchor="end"'));
    g.push(txt(X(-560), Y(-140), 'M12 × 2  랩 끝', 'font-size="11" fill="var(--accent)"'));
    g.push(txt(X(30), Y(-140), '클리트 PL-8 · M12 × 2', 'font-size="11" fill="var(--text-dim)"'));
    // 단면 표시 A
    var ax = X(300);
    g.push(ln(ax, Y(128), ax, Y(-128), 'stroke="var(--text)" stroke-width="1.2" stroke-dasharray="12 4 3 4"'));
    [[Y(128), -1], [Y(-128), 1]].forEach(function (p) { g.push(ln(ax, p[0], ax + 18, p[0], 'stroke="var(--text)" stroke-width="1.6"') + arrowHead(ax + 18, p[0], 0, 8, 'var(--text)') + txt(ax + 24, p[0] + 4, 'A', 'font-size="13" font-weight="700" fill="var(--text)"')); });

    // Cut A-A — 중첩 Z 두 겹, 2.0 px/mm
    var s2 = 1.8, ax0 = 250, ay0 = 632, gz = zGeom(), Pz = gz.pts;
    function XA(x) { return ax0 + s2 * x; } function YA(y) { return ay0 - s2 * y; }
    g.push(txt(24, 392, 'Cut A-A', 'font-size="13" fill="var(--text)" font-weight="600"'));
    g.push(txt(92, 392, '중첩 — 개략', 'font-size="11" fill="var(--text-faint)"'));
    // 데크
    var dkY = YA(gz.hy + gz.t / 2) - 1;
    g.push('<path d="M' + f(XA(-80)) + ' ' + f(dkY - 24) + ' H' + f(XA(-48)) + ' L' + f(XA(-36)) + ' ' + f(dkY) + ' H' + f(XA(96)) + ' L' + f(XA(108)) + ' ' + f(dkY - 24) + ' H' + f(XA(150)) + '" fill="none" stroke="var(--text-dim)" stroke-width="1.4"/>');
    g.push(ln(XA(40), dkY - 9, XA(40), dkY + 12, 'stroke="var(--text)" stroke-width="2"') + ln(XA(40) - 5, dkY - 9, XA(40) + 5, dkY - 9, 'stroke="var(--text)" stroke-width="2"'));
    g.push(txt(XA(112), dkY - 30, '데크 · 관통 체결', 'font-size="10.5" fill="var(--text-faint)"'));    var zp = function (dx, dy, wTop, wBot) { // 바깥 Z: 그대로 · 안쪽 Z: (+t, −t) 이동, 윗 플랜지 좁게 · 아래 플랜지 넓게
      return Pz.map(function (p, i) {
        var x = p.x, y = p.y;
        if (i > 22) { x = x * wTop; } if (i < 14) { x = x * wBot; }
        return f(XA(x + dx)) + ' ' + f(YA(y + dy));
      }).join(' L');
    };
    g.push('<path d="M' + zp(0, 0, 1, 1) + '" fill="none" stroke="var(--steel)" stroke-width="' + f(gz.t * s2) + '" stroke-linejoin="round"/>');
    g.push('<path d="M' + zp(gz.t, -gz.t, 0.93, 1.07) + '" fill="none" stroke="var(--steel2)" stroke-width="' + f(gz.t * s2) + '" stroke-linejoin="round"/>');
    [60, -60].forEach(function (y) {
      var by = YA(y);
      g.push('<rect x="' + f(XA(-14)) + '" y="' + f(by - 8) + '" width="7" height="16" fill="var(--accent)"/>');
      g.push(ln(XA(-7), by, XA(22), by, 'stroke="var(--accent)" stroke-width="' + f(12 * s2 * 0.5) + '"'));
      g.push('<rect x="' + f(XA(10)) + '" y="' + f(by - 9) + '" width="8" height="18" fill="none" stroke="var(--accent)" stroke-width="1.6"/>');
    });
    g.push(dim(XA(-118), YA(60), XA(-118), YA(-60), '120', { dx: -12 }));
    g.push(ln(XA(-16), YA(60), XA(-122), YA(60), 'stroke="var(--dimc)" stroke-width=".8"') + ln(XA(-16), YA(-60), XA(-122), YA(-60), 'stroke="var(--dimc)" stroke-width=".8"'));
    g.push(txt(XA(26), YA(66), 'M12', 'font-size="11" fill="var(--accent)"'));
    g.push(txt(XA(-100), YA(-118), '바깥 P1-1', 'font-size="11" fill="var(--steel)"'));
    g.push(txt(XA(30), YA(-118), '안쪽 P1-2', 'font-size="11" fill="var(--steel2)"'));

    // 패스너 배치 — 랩 끝 상세
    var px0 = 690, py0 = 440, s3 = 1.5;
    g.push(txt(px0 - 20, 392, '패스너 배치', 'font-size="13" fill="var(--text)" font-weight="600"'));
    g.push(txt(px0 + 70, 392, '랩 끝 · P1-2 웨브', 'font-size="11" fill="var(--text-faint)"'));
    function XP(x) { return px0 + s3 * x; } function YP(y) { return py0 + s3 * (100 - y); }
    g.push('<rect x="' + f(XP(0)) + '" y="' + f(YP(100)) + '" width="' + f(260 * s3) + '" height="' + f(200 * s3) + '" fill="var(--steel2)" fill-opacity=".06" stroke="var(--steel2)" stroke-width="1.4"/>');
    g.push(ln(XP(0), YP(80), XP(260), YP(80), 'stroke="var(--steel2)" stroke-dasharray="7 4"') + ln(XP(0), YP(-80), XP(260), YP(-80), 'stroke="var(--steel2)" stroke-dasharray="7 4"'));
    g.push('<path d="M' + f(XP(260)) + ' ' + f(YP(100)) + ' l-6 40 l12 12 l-10 40 l8 12 l-4 ' + f(200 * s3 - 104) + '" fill="none" stroke="var(--text-faint)"/>');
    [[36, 60], [36, -60]].forEach(function (b) { g.push('<circle cx="' + f(XP(b[0])) + '" cy="' + f(YP(b[1])) + '" r="' + f(13 / 2 * s3 + 1) + '" fill="var(--bg-view)" stroke="var(--accent)" stroke-width="1.6"/>' + ln(XP(b[0]) - 12, YP(b[1]), XP(b[0]) + 12, YP(b[1]), 'stroke="var(--accent)"') + ln(XP(b[0]), YP(b[1]) - 12, XP(b[0]), YP(b[1]) + 12, 'stroke="var(--accent)"')); });
    g.push(dim(XP(0), YP(100) - 22, XP(36), YP(100) - 22, '', {}) + txt(XP(18), YP(100) - 30, 'e 36', 'font-size="11" text-anchor="middle" fill="var(--dimc)" font-family="var(--mono)"'));
    g.push(ln(XP(36), YP(60) - 12, XP(36), YP(100) - 26, 'stroke="var(--dimc)" stroke-width=".8"') + ln(XP(0), YP(100) - 4, XP(0), YP(100) - 26, 'stroke="var(--dimc)" stroke-width=".8"'));
    g.push(dim(XP(110), YP(60), XP(110), YP(-60), 'g 120', { dx: 16 }));
    g.push(ln(XP(36) + 12, YP(60), XP(116), YP(60), 'stroke="var(--dimc)" stroke-width=".8"') + ln(XP(36) + 12, YP(-60), XP(116), YP(-60), 'stroke="var(--dimc)" stroke-width=".8"'));
    g.push(dim(XP(170), YP(100), XP(170), YP(60), '40', { dx: 14 }));
    g.push(ln(XP(36) + 12, YP(60), XP(176), YP(60), 'stroke="var(--dimc)" stroke-width=".5" stroke-dasharray="2 3"'));
    g.push(txt(XP(0), YP(-100) + 22, '구멍 13 · 단부 거리 e ≥ 1.5d = 18 · 지압 t 2.3', 'font-size="11" fill="var(--text-faint)" font-family="var(--mono)"'));
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="랩 접합 도면">' + g.join('') + '</svg>';
  }

  function fillDrawings(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-draw]'), function (v) {
      var o = {}; try { o = JSON.parse(v.getAttribute('data-opt') || '{}'); } catch (e) { o = {}; }
      var k = v.getAttribute('data-draw');
      var svg = k === 'section' ? secView(o) : k === 'curve' ? curveView(o) : k === 'member' ? memberView(o) : k === 'lap' ? lapView(o) : '';
      v.insertAdjacentHTML('afterbegin', svg);
    });
    /* 절점 · 요소 표 — 그림과 같은 형상에서 만든다 */
    Array.prototype.forEach.call(root.querySelectorAll('[data-table="nodes"]'), function (t) {
      var g = zGeom(), sel = +(t.getAttribute('data-sel') || 0);
      t.innerHTML = '<thead><tr><th>절점</th><th class="r">x</th><th class="r">z</th><th class="r" data-tip="기준 응력 · 정휨 M+ · 압축 +">σ MPa</th></tr></thead><tbody>' + g.pts.map(function (p, i) {
        return '<tr' + (i + 1 === sel ? ' class="on"' : '') + '><td>' + (i + 1) + '</td><td class="r num">' + f(p.x + g.b, 2) + '</td><td class="r num">' + f(p.y + g.hy, 2) + '</td><td class="r num">' + f(245 * p.y / g.hy, 1) + '</td></tr>';
      }).join('') + '</tbody>';
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-table="elems"]'), function (t) {
      var g = zGeom(), sel = +(t.getAttribute('data-sel') || 0);
      t.innerHTML = '<thead><tr><th>요소</th><th class="r">i</th><th class="r">j</th><th class="r">t mm</th><th>자리</th></tr></thead><tbody>' + g.els.map(function (e, k) {
        var part = k < 2 ? '아래 립' : k < 6 ? '모서리' : k < 10 ? '아래 플랜지' : k < 14 ? '모서리' : k < 22 ? '웨브' : k < 26 ? '모서리' : k < 30 ? '윗 플랜지' : k < 34 ? '모서리' : '윗 립';
        return '<tr' + (k + 1 === sel ? ' class="on"' : '') + '><td>' + (k + 1) + '</td><td class="r num">' + (e.i + 1) + '</td><td class="r num">' + (e.j + 1) + '</td><td class="r num">2.30</td><td class="dim">' + part + '</td></tr>';
      }).join('') + '</tbody>';
    });
  }

  /* ── 왼쪽 트리 — 탭 4개(업무 · 모델 · 결과 · 문서). 줄마다 이름과 값 · 개수 · 상태 ───────── */
  function n(k, t, v, o) { o = o || {}; o.k = k; o.t = t; o.v = v; return o; }
  function trees(c) {
    var early = c.moment === '1012'; // 07: AI 가 두께를 바꾼 직후
    var changes = early
      ? [n('c4', '두께 t 2.0 → 2.3', 'AI · 10:12', { dot: 'acc', m: 'change', href: '07-work.html' }),
        n('c3', '랩 길이 450 → 600', 'AI · 10:08', { dot: 'acc', m: 'change' }),
        n('c2', '하중 조합 7 생성', 'AI · 09:41', { m: 'change' }), n('c1', '단면 Z-200×75×20×2.0', 'AI · 09:38', { m: 'change' })]
      : [n('c5', '적설 S 0.7 → 0.5', '사용자 · 10:31', { dot: 'ok', m: 'change', tip: '대화창에서 사람이 고친 값' }),
        n('c4', '두께 t 2.0 → 2.3', 'AI · 10:12', { dot: 'acc', m: 'change', href: '07-work.html' }),
        n('c3', '랩 길이 450 → 600', 'AI · 10:08', { dot: 'acc', m: 'change' }),
        n('c2', '하중 조합 7 생성', 'AI · 09:41', { m: 'change' }), n('c1', '단면 Z-200×75×20×2.0', 'AI · 09:38', { m: 'change' })];
    var stale = early ? ['낡음', 'warn'] : null;
    return {
      work: [
        n('ask', '판단 요청', ['1', 'warn'], { open: true, tip: 'AI 가 묻고 답을 기다리는 것', kids: [
          n('q1', '랩 패스너의 힘 분배 모델', '답 기다림', { dot: 'warn', m: 'work', tip: '기준 조항이 없어 자체 가정으로 계산했다. 그 가정을 써도 되는지 묻는 중', href: '06-connection.html' })] }),
        n('rep', '보고', '2', { open: !early, kids: [
          n('r2', '보고 #2 · 두께와 랩 조정', '10:16', { m: 'work', kids: [
            n('r2a', '두께 2.0 → 2.3', '완료', { m: 'work' }), n('r2b', '랩 450 → 600', '완료', { m: 'work' }),
            n('r2c', '랩 패스너 자체 가정', ['가정', 'warn'], { m: 'work' }), n('r2d', '랩 구간 휨 미검토', ['미결', 'ng'], { m: 'work' })] }),
          n('r1', '보고 #1 · 첫 검토', '09:45', { m: 'work' })] }),
        n('chg', '변경', String(changes.length), { open: true, tip: 'AI 와 사람의 변경이 같은 줄에 선다', kids: changes }),
        n('chk', '점검', early ? ['낡음', 'warn'] : ['주의 3', 'warn'], { open: !early, tip: '실패 0 · 주의 3 · 통과 67', kids: [
          n('v1', '접합부 결과가 입력보다 오래됨', '', { dot: 'warn', m: 'work' }),
          n('v2', '데크 두께 · 체결 간격이 기본값', '', { dot: 'warn', m: 'work', tip: '관통 체결 데크 kφ 를 이 두 값으로 계산했다' }),
          n('v3', '랩 구간 휨 미검토', '', { dot: 'warn', m: 'work' }),
          n('v4', '통과', '67', { faint: true }), n('v5', '실패', '0', { faint: true })] })
      ],
      model: [
        n('sec', '단면', '립 Z 200×75×20×2.3', { href: '01-section.html', kids: [
          n('sdim', '치수', 'H200 B75 D20 t2.3 r4', { m: 'val' }), n('snode', '절점', '37', { m: 'val' }), n('selem', '요소', '36', { m: 'val' }),
          n('sspr', '스프링', '0', { m: 'val', tip: '데크의 회전 구속을 해석 모델에 넣지 않았다. kφ 는 설계 단계에서 쓴다' }), n('scon', '구속', '0', { m: 'val' })] }),
        n('mat', '재료', 'SGC400', { kids: [n('mfy', 'Fy', '245 MPa', { m: 'val' }), n('mfu', 'Fu', '400 MPa', { m: 'val' }), n('mE', 'E', '203 000 MPa', { m: 'val' })] }),
        n('mem', '부재', '지붕 퍼린 · 3연속', { kids: [
          n('mspan', '스팬', '3 × 6.0 m', { m: 'val' }), n('msup', '지점', '4', { m: 'val' }), n('mlap', '랩', '2 · 600/600', { m: 'val' }),
          n('msp', '간격', '1.2 m', { m: 'val' }), n('mdeck', '데크', '관통 체결', { m: 'val' })] }),
        n('ld', '하중', '5', { kids: [
          n('lD', 'D', '0.30 kPa', { m: 'val' }), n('lLr', 'Lr', '1.00 kPa', { m: 'val' }), n('lS', 'S', '0.50 kPa', { m: 'val' }),
          n('lWu', 'W↑', '1.00 kPa', { m: 'val' }), n('lWd', 'W↓', '1.00 kPa', { m: 'val' }), n('lC', '조합', '7', { m: 'val' })] }),
        n('dc', '설계 조건', 'LRFD', { kids: [
          n('dLbp', 'Lb · Cb  정', '0 · 1.00', { m: 'val' }), n('dLbn', 'Lb · Cb  부', '2.01 m · 1.94', { m: 'val' }),
          n('dwc', '웹 크리플링', 'IOF · N 100', { m: 'val' }), n('dopt', '옵션', '냉간가공 · R · β', { m: 'val' })] }),
        n('cj', '접합부', '1', { kids: [n('cj1', '랩 P1-B', 'M12 × 2', { m: 'val' })] }),
        n('asm', '가정', ['임시 2', 'warn'], { open: true, tip: '가정 목록. 계산서 1장에 그대로 실린다', kids: [
          n('A01', 'A-01  데크 t 0.5 · 체결 300', ['임시', 'warn'], { m: 'val', tip: '입력 기본값을 그대로 썼다. 데크 kφ 가 이 값에서 나온다' }),
          n('A02', 'A-02  랩 패스너 힘 분배', ['임시', 'warn'], { m: 'val' }),
          n('A03', 'A-03  지점 지압 길이 N 100', ['확정', 'ok'], { m: 'val' }),
          n('A04', 'A-04  처짐 한계 L/240', ['확정', 'ok'], { m: 'val' })] })
      ],
      result: [
        n('props', '단면 성질', 'A 872 mm²', { m: 'val', href: '01-section.html' }),
        n('fsm', '좌굴 해석', early ? ['다시 실행 중', 'acc'] : ['일치', 'ok'], { dot: early ? 'acc' : 'ok', href: '02-buckling.html', tip: 'S-S · 반파장 10–10000 mm 60점 · 고유치 10 · cFSM 분류', kids: [
          n('fP', '압축 P', 'Py 213.6 kN', { kids: [n('fPl', '국부 Pcrl/Py', '0.38 @ 110 mm'), n('fPd', '뒤틀림 Pcrd/Py', '0.62 @ 540 mm'), n('fPg', '전체 Pcre/Py', '0.09 @ 6000 mm')] }),
          n('fMp', '정휨 M+', 'My 12.69 kN·m', { kids: [
            n('fMpl', '국부 Mcrl/My', '1.62 @ 130 mm', { m: 'val' }), n('fMpd', '뒤틀림 Mcrd/My', '0.85 @ 620 mm', { m: 'val', href: '02-buckling.html' }),
            n('fMpg', '전체 Mcre/My', '0.25 @ 6000 mm', { m: 'val' })] }),
          n('fMn', '부휨 M−', '= M+', { tip: 'Z 는 점대칭이고 스프링이 없어 M+ 와 곡선이 같다', kids: [
            n('fMnl', '국부 Mcrl/My', '1.62 @ 130 mm', { m: 'val' }), n('fMnd', '뒤틀림 Mcrd/My', '0.85 @ 620 mm', { m: 'val' }), n('fMng', '전체 Mcre/My', '0.25 @ 6000 mm', { m: 'val' })] }),
          n('fcls', '모드 분류', 'cFSM', { m: 'val' }), n('fpl', '소성 곡면', '실행함', { m: 'val' }), n('fvib', '진동', ['실행 안 함', 'un'], { m: 'val' })] }),
        n('load', '하중 해석', stale || ['일치', 'ok'], { dot: early ? 'warn' : 'ok', href: '03-loads.html', kids: [
          n('lcmb', '조합', '7', { m: 'val' }), n('lgov', '지배 조합', '1.2D+1.6Lr+0.5W↓', { m: 'val', href: '03-loads.html' }),
          n('lpos', '위치', '9', { m: 'val' }), n('ldef', '처짐', 'L/475', { m: 'val' })] }),
        n('chk', '부재 검토', stale || '확인 3/12', { dot: early ? 'warn' : '', href: '04-checks.html', tip: '확인 = 사람이 확인 표시를 한 수 / 전체 검토 수', kids: [
          n('cNG', 'NG', '0'),
          n('cUN', '미검토', ['1', 'un'], { open: true, tip: '합격이 아니다', kids: [n('u1', '랩 구간 휨 — 유효단면계수 없음', '', { dot: 'un', m: 'ls', href: '05-sheet.html' })] }),
          n('cOK', 'OK', '11', { open: true, kids: [
            n('k01', '부모멘트 구간 · 뒤틀림 좌굴', '0.87', { dot: 'ok', m: 'ls', href: '04-checks.html' }),
            n('k02', '정모멘트 구간 · 뒤틀림 좌굴', '0.79', { dot: 'ok', m: 'ls' }),
            n('k03', '지점 B · 휨+웹 크리플링', '0.74', { dot: 'ok', m: 'ls' }),
            n('k04', '정모멘트 구간 · 국부 좌굴', '0.73', { dot: 'ok', m: 'ls' }),
            n('k05', '지점 A · 웹 크리플링', '0.73', { dot: 'ok', m: 'ls', mark: 'done' }),
            n('k06', '부모멘트 구간 · 휨+전단', '0.66', { dot: 'ok', m: 'ls' }),
            n('k07', '부모멘트 구간 · 국부 좌굴', '0.64', { dot: 'ok', m: 'ls' }),
            n('k08', '부모멘트 구간 · 횡좌굴', '0.64', { dot: 'ok', m: 'ls' }),
            n('k09', '양압 · 횡좌굴', '0.28', { dot: 'ok', m: 'ls' }),
            n('k10', '지점 B · 전단', '0.23', { dot: 'ok', m: 'ls', mark: 'done' }),
            n('k11', '지점 A · 전단', '0.15', { dot: 'ok', m: 'ls', mark: 'done' })] })] }),
        n('conn', '접합부 검토', ['낡음', 'warn'], { dot: 'warn', tip: '10:15 에 실행. 그 뒤 적설 S 가 바뀌었다', kids: [
          n('cn1', '랩 P1-B · 패스너', '0.83', { dot: 'ok', m: 'ls', tag: '자체 가정', href: '06-connection.html' })] }),
        n('alt', '대안', '3', { kids: [
          n('a20', 'Z-200×75×20×2.0', ['NG 1.05', 'ng'], { m: 'alt' }), n('a23', 'Z-200×75×20×2.3', '0.87 · 지금', { m: 'alt' }), n('a26', 'Z-200×75×20×2.6', '0.73', { m: 'alt' })] })
      ],
      doc: [
        n('rpt', '계산서', ['초안', 'warn'], { m: 'doc', href: '08-documents.html' }),
        n('brpt', '좌굴 해석 보고서', ['일치', 'ok'], { m: 'doc' }),
        n('vtab', '검증표', ['주의 3', 'warn'], { m: 'doc', tip: '점검 70개를 표로 낸 것' }),
        n('src', '원자료', '2', { open: true, kids: [n('s1', '지붕 평면도.pdf', '', { m: 'doc' }), n('s2', '데크 제품 자료.pdf', '', { m: 'doc' })] }),
        n('pub', '발행', '', { open: true, kids: [n('R0', 'R0', ['아직 없음', 'un'], { m: 'doc' })] })
      ]
    };
  }
  function treeHtml(nodes, sel, openSet, closeSet) {
    function has(x) { return x.k === sel || (x.kids || []).some(has); }
    function row(x, d) {
      var kids = x.kids || [];
      var open = kids.length && !closeSet[x.k] && (x.open || openSet[x.k] || (x.k !== sel && has(x)));
      var v = x.v instanceof Array ? '<span class="vl ' + x.v[1] + '">' + x.v[0] + '</span>' : (x.v ? '<span class="vl">' + x.v + '</span>' : '');
      var mark = x.mark ? '<span class="rv ' + x.mark + '" data-tip="' + (x.mark === 'done' ? '확인함' : '이의 있음 — AI 의 답을 기다리는 중') + '"></span>' : '';
      var tag = x.tag ? '<span class="tag def" data-tip="기준 조항이 아닌 자체 해석. 판단 요청에 걸려 있다">' + x.tag + '</span>' : '';
      var h = '<a class="row' + (d === 0 ? ' top' : '') + (x.k === sel ? ' on' : '') + (x.faint ? ' faint' : '') + '" data-k="' + x.k + '" data-m="' + (x.m || 'group') + '" style="padding-left:' + (8 + d * 14) + 'px"' +
        (x.href ? ' href="' + x.href + '"' : '') + (x.tip ? ' data-tip="' + x.tip + '"' : '') + '>' +
        '<span class="tw">' + (kids.length ? (open ? '▾' : '▸') : '') + '</span>' + (x.dot ? '<span class="dot ' + x.dot + '"></span>' : '') +
        '<span class="nm">' + x.t + '</span>' + mark + tag + v + '</a>';
      if (open) { h += kids.map(function (k) { return row(k, d + 1); }).join(''); }
      return h;
    }
    return nodes.map(function (x) { return row(x, 0); }).join('');
  }
  function setOf(s) { var o = {}; (s || '').split(',').forEach(function (k) { if (k) { o[k.trim()] = 1; } }); return o; }

  /* ── 우클릭 메뉴 — "보는 일"과 사람만 하는 확인 표시만 둔다. 값 바꾸기 · 다시 실행 · 대안 만들기는 없다 ──
     줄 = [이름, 단축키] · '-' 는 구분선 */
  var MENUS = {
    ls: [['보기에서 찾기', 'F'], ['이 위치만 보기', 'I'], '-', ['계산 시트 열기', 'Enter'], ['표에서 보기', ''], '-', ['확인 표시', 'Space'], ['이름 복사', 'Ctrl+C']],
    val: [['출처 보기', ''], ['표에서 보기', ''], '-', ['복사', 'Ctrl+C']],
    group: [['모두 펼치기', ''], ['모두 접기', ''], ['표로 열기', '']],
    work: [['대상 보기', 'F'], '-', ['확인 표시', 'Space'], ['내용 복사', 'Ctrl+C']],
    change: [['바뀐 곳 보기', 'F'], ['바뀐 값 표 열기', ''], '-', ['확인 표시', 'Space'], ['내용 복사', 'Ctrl+C']],
    alt: [['지금 단면과 비교', ''], ['표에서 보기', ''], '-', ['이름 복사', 'Ctrl+C']],
    doc: [['열기', 'Enter'], ['폴더에서 보기', ''], '-', ['경로 복사', '']],
    view: [['전체 맞춤', 'Home'], ['표시 항목', '▸'], '-', ['그림 복사', '']],
    trow: [['보기에서 찾기', 'F'], '-', ['행 복사', 'Ctrl+C'], ['CSV 로 내보내기', '']]
  };
  function menuEl(kind, title) {
    return el('<div class="ctx">' + (title ? '<div class="ct">' + title + '</div>' : '') + (MENUS[kind] || MENUS.view).map(function (r) {
      if (r === '-') { return '<hr>'; }
      return '<div class="ci"><span>' + r[0] + '</span><kbd>' + r[1] + '</kbd></div>';
    }).join('') + '</div>');
  }
  function menus() {
    var live = null;
    function close() { if (live) { live.remove(); live = null; } }
    function open(kind, title, x, y) {
      close(); live = menuEl(kind, title); document.body.appendChild(live);
      live.style.left = Math.min(x, window.innerWidth - live.offsetWidth - 6) + 'px';
      live.style.top = Math.min(y, window.innerHeight - live.offsetHeight - 6) + 'px';
    }
    document.addEventListener('contextmenu', function (e) {
      var row = e.target.closest('.tree .row'), tr = e.target.closest('.drawer tbody tr, .pane-detail tbody tr'), v = e.target.closest('.dv');
      if (!row && !tr && !v) { return; }
      e.preventDefault();
      if (row) { open(row.getAttribute('data-m'), row.querySelector('.nm').textContent, e.clientX, e.clientY); }
      else if (tr) { open('trow', '', e.clientX, e.clientY); }
      else { open('view', '', e.clientX, e.clientY); }
    });
    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); } });
    /* 정지 화면에서 메뉴의 모습을 보이려고 펼쳐 둔 것.
       <i class="ctx-at" data-menu="ls" data-row="k01" data-dx="150" data-dy="14"> — 트리 줄 기준
       <i class="ctx-at" data-menu="view" style="left:..;top:.."> — 화면 좌표 */
    Array.prototype.forEach.call(document.querySelectorAll('.ctx-at'), function (a) {
      var m = menuEl(a.getAttribute('data-menu'), a.getAttribute('data-title') || ''); m.classList.add('pinned');
      var rk = a.getAttribute('data-row');
      if (rk) {
        var r = document.querySelector('.tree .row[data-k="' + rk + '"]');
        if (r && !r.getBoundingClientRect().width) { a.remove(); return; } // 좁은 창: 트리가 접혀 있으면 펼친 메뉴도 없다
        if (r) { var b = r.getBoundingClientRect(); m.style.left = (b.left + (+a.getAttribute('data-dx') || 120)) + 'px'; m.style.top = (b.top + (+a.getAttribute('data-dy') || 14)) + 'px'; }
        if (!m.querySelector('.ct') && r) { m.insertAdjacentHTML('afterbegin', '<div class="ct">' + r.querySelector('.nm').textContent + '</div>'); }
        document.body.appendChild(m); a.remove();
      } else { m.style.left = a.style.left; m.style.top = a.style.top; a.parentNode.replaceChild(m, a); }
    });
  }

  /* ── 풍선 도움말 ─────────────── */
  function tips() {
    function place(box, t) {
      var r = t.getBoundingClientRect();
      box.style.left = Math.max(6, Math.min(r.left, window.innerWidth - box.offsetWidth - 6)) + 'px';
      box.style.top = (r.bottom + 6 + box.offsetHeight > window.innerHeight ? r.top - box.offsetHeight - 6 : r.bottom + 6) + 'px';
    }
    function make(t) { var b = el('<div class="tipbox"></div>'); b.textContent = t.getAttribute('data-tip'); document.body.appendChild(b); place(b, t); return b; }
    var live = null;
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (live) { live.remove(); live = null; }
      if (t && !t.hasAttribute('data-tip-show')) { live = make(t); }
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tip][data-tip-show]'), function (t) { make(t).classList.add('pinned'); });
  }

  /* ── 진행 띠 — 결과가 입력과 맞는지. 길잡이가 아니라 상태 표시다. 누르면 트리의 그 가지를 고른다 ── */
  var STEPS = [
    ['sec', '단면', '단면', '01-section.html'], ['fsm', '좌굴 해석', '좌굴', '02-buckling.html'], ['load', '하중 해석', '하중', '03-loads.html'],
    ['chk', '부재 검토', '검토', '04-checks.html'], ['conn', '접합부', '접합', '06-connection.html'], ['val', '점검', '점검', '07-work.html']
  ];
  var STIP = {
    ok: '입력과 일치', stale: '입력이 바뀐 뒤 다시 돌리지 않음', none: '실행 안 함', run: '다시 실행 중'
  };
  var SNOTE = {
    sec: '절점 37 · 요소 36 · 10:12', fsm: '10:14 실행 · S-S · 60점', load: '10:33 실행 · 조합 7', chk: '10:33 실행 · 12 항목',
    conn: '10:15 실행 · 그 뒤 적설 S 가 바뀜(10:31). 값은 같을 수 있다', val: '10:34 · 실패 0 · 주의 3 · 통과 67'
  };
  function pipeHtml(states) {
    return '<span class="pipe">' + STEPS.map(function (s, i) {
      var st = states[i] || 'ok';
      return (i ? '<b>→</b>' : '') + '<a class="ps ' + st + '" href="' + s[3] + '" data-tip="' + s[1] + ' · ' + STIP[st] + ' · ' + SNOTE[s[0]] + '"><i></i><em class="lg">' + s[1] + '</em><em class="sh">' + s[2] + '</em></a>';
    }).join('') + '</span>';
  }

  /* ── 창 틀 ─────────────────────────────────── */
  var TABS = [['work', '업무', '07-work.html'], ['model', '모델', '01-section.html'], ['result', '결과', '04-checks.html'], ['doc', '문서', '08-documents.html']];
  function build() {
    var page = document.getElementById('page');
    if (!page) { fillDrawings(document); tips(); return; }
    var layout = page.getAttribute('data-layout') || 'review';
    var file = location.pathname.split('/').pop() || '';
    var idx = ORDER.map(function (x) { return x[0]; }).indexOf(file);
    var prev = idx > 0 ? ORDER[idx - 1] : null, next = idx >= 0 && idx < ORDER.length - 1 ? ORDER[idx + 1] : null;
    var edit = layout === 'edit', start = layout === 'start', sheet = layout === 'sheet';
    var ai = page.getAttribute('data-ai') === 'working';
    var tab = page.getAttribute('data-tab') || 'work';
    var share = page.getAttribute('data-share') || '';
    var pipe = (page.getAttribute('data-pipe') || 'ok ok ok ok stale ok').split(' ');

    var ribbon = el('<div class="tpl-ribbon"><b>독립 프로그램 템플릿</b><span>' + (idx >= 0 ? ORDER[idx][1] : '') +
      '</span><span class="faint">정적 화면 · 동작 없음 · 수치는 예시</span><span class="sp"></span>' +
      (prev ? '<a href="' + prev[0] + '">← ' + prev[1] + '</a>' : '') + (next ? '<a href="' + next[0] + '">' + next[1] + ' →</a>' : '') +
      '<a href="index.html">목록</a></div>');

    /* 제목 표시줄 — 프로젝트 · 검토 대상 · 진행 띠 | 찾기 · AI 따라가기 · 편집 · Claude 연결 */
    var tbar = '<div class="tbar' + (edit ? ' edit' : '') + '"><span class="logo">StCFSD</span>' +
      (start ? '' : '<span class="proj" data-tip="프로젝트 바꾸기 · 폴더 하나에 검토 대상 여럿">' + PROJECT + ' ▾</span>' +
        '<span class="pick" data-tip="검토 대상 하나 = .csd 파일 하나 (단면 + 부재 조건 + 하중 + 검토)">검토 대상 <b>' + CASE + '</b> ▾</span>' +
        (edit ? '<span class="ebadge" data-tip="입력 화면이 열려 있다. 트리와 제목 줄은 그대로다">편집</span>' : '') + pipeHtml(pipe)) +
      '<span class="sp"></span>' +
      (start ? '' : '<span class="tb" data-tip="절점 · 한계상태 · 조합 찾기  Ctrl+F">찾기</span>' +
        '<span class="tb' + (edit ? '' : ' on') + '" data-tip="AI 가 일하는 자리로 화면이 따라간다. 이 창을 만지면 멈춘다">AI 따라가기</span>' +
        '<span class="tb' + (edit ? ' on edit' : '') + '" data-tip="지금의 입력 화면(6탭)을 연다. 다시 누르면 닫힌다">편집 F2</span>') +
      '<span class="conn" data-tip="대화는 Claude Desktop 에서 한다">' + (page.getAttribute('data-conn') === 'off'
        ? '<span class="dot un"></span>Claude 등록 안 됨' : '<span class="dot ok"></span>Claude 연결됨') + '</span>' +
      '<span class="wc"><i>—</i><i>☐</i><i>✕</i></span></div>';

    var aibar = ai ? '<div class="aibar"><span class="pulse"></span><b>AI 작업 중</b><span>' + (page.getAttribute('data-ai-text') || '') +
      '</span><span class="sp"></span><span class="dim">화면이 AI 를 따라가는 중</span></div>' : '';
    var status = '<div class="status">' + (page.getAttribute('data-status') || '') + '<span class="sp"></span><span>AISI S100-16 · LRFD · SI</span><span>' + (ai ? 'AI 작업 중' : 'AI 대기') + '</span></div>';

    var win = el('<div class="win' + (edit ? ' edit' : '') + '">' + tbar + aibar + '</div>');
    var strip = page.querySelector(':scope > .strip'); if (strip) { win.appendChild(strip); }

    if (!start && !sheet) {
      var T = trees({ moment: page.getAttribute('data-moment') || '' });
      var left = el('<div class="left"><div class="ttabs">' + TABS.map(function (t) {
        return '<a class="' + (t[0] === tab ? 'on' : '') + '" href="' + t[2] + '">' + t[1] + (t[0] === 'work' ? ' <span class="badge warn" data-tip="답을 기다리는 판단 요청">1</span>' : '') + '</a>';
      }).join('') + '</div><div class="tree">' + treeHtml(T[tab], page.getAttribute('data-sel') || '', setOf(page.getAttribute('data-open')), setOf(page.getAttribute('data-close'))) + '</div></div>');
      page.insertBefore(left, page.firstChild);
    }
    if (sheet) {
      page.insertBefore(el('<div class="rail"><i data-tip="트리 펼치기">☰</i>' + TABS.map(function (t) { return '<i class="' + (t[0] === tab ? 'on' : '') + '">' + t[1].charAt(0) + '</i>'; }).join('') + '</div>'), page.firstChild);
    }
    var detail = page.querySelector('.pane-detail');
    if (detail) {
      var right = el('<div class="right"></div>');
      page.insertBefore(right, detail);
      right.appendChild(detail);
      if (share) {
        right.appendChild(el('<div class="share" data-tip="Claude 가 이 선택을 읽을 수 있다. Claude Desktop 에서 「이거」, 「지금 선택한 것」이라고 말하면 된다. 답 · 수정 · 요청은 대화창에 말로 쓴다"' +
          (page.hasAttribute('data-share-tip') ? ' data-tip-show' : '') + '><span class="dot ok"></span><span>Claude 가 보는 선택</span><b>' + share + '</b></div>'));
      }
    }
    if (!detail && share) { status = status.replace('<span class="sp"></span>', '<span class="sp"></span><span data-tip="Claude 가 이 선택을 읽을 수 있다. 대화창에서 「이거」라고 말하면 된다"><span class="dot ok" style="margin-right:5px"></span>Claude 가 보는 선택 <b>' + share + '</b></span>'); }
    page.classList.add('body');
    if (sheet) { page.classList.add('sheetl'); }
    if (start) { page.classList.add('startl'); }
    if (edit) { page.classList.add('editl'); }
    win.appendChild(page);
    win.appendChild(el(status));
    document.body.insertBefore(ribbon, document.body.firstChild);
    document.body.appendChild(win);
    fillDrawings(document);
    tips();
    menus();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', build); } else { build(); }
})();
