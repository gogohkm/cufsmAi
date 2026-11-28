/* global module, globalThis */
/**
 * K3-7 — 보고서 그리기(순수 · UMD). ReportDoc(데이터) → HTML. 수를 만들지 않는다: 값은 ReportDoc 에 이미 그 단위로 있고
 * (US 는 엔진 값 그대로, SI 는 호스트가 src/mcp/siUnits.ts reportDocToSI 로 바꾼 것), 여기서는 자리수 · 단위 이름만 붙인다.
 * 호스트(StcfsdPanel — 화면 · PDF · MCP)가 require 하고, 새 화면(desktop/ui)도 같은 ReportDoc 을 이것으로 그릴 수 있다.
 *
 * 글은 모두 이스케이프한다(엔진 · 상태 · AI 가 준 글 — 제목, 칸, 알림, 식, 기호). HTML 을 그대로 넣는 블록은 없다.
 * 그림(단면 · 서명곡선 · 보 · 도표)은 ReportDoc 의 수열을 그리기만 한다(축 눈금 · 위치는 그림의 계산).
 *
 * ReportDoc 모양(docs/implementation/20261124-k3-design.md §12):
 *   { schema: 'stcfsd-report/1', meta: {title, date, spec, method, units: 'US'|'SI', design_method, member_type, stamp?},
 *     verdict: {state, utilization, governing}, sections: [{id, title, blocks: Block[]}] }
 *   값 = {value, quantity, digits?} (value null = 값 없음, unbounded: true = ∞) · 수열 = {values: [...], quantity}
 *   Block = table {head, rows: Cell[][], note?} · para {text, tone?} · list {title, items, tone?} · check {check: design_checks[*]}
 *         · section {nodes: 수열[[x, z]], elems: [[i, j]]} · curve {L, LF, marks} · beam {spans, supports, laps}
 *         · diagram {title, x, y, flip, color, marks} · image {src: data:image/png;base64 만} · heading {text}
 *   Cell = 글 | 값 | {text, tone?} | {unit_of: quantity}
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.StcfsdReportRender = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /** quantity → 단위 이름 · 기본 자리수(US · SI). 변환 계수는 여기에 없다(바꾸는 일은 siUnits) */
    const QUNIT = {
        force: { US: 'kips', SI: 'kN', d: [2, 2] },
        moment: { US: 'kip-in', SI: 'kN-m', d: [2, 2] },
        moment_ft: { US: 'kip-ft', SI: 'kN-m', d: [2, 2] },
        stress: { US: 'ksi', SI: 'MPa', d: [2, 1] },
        length: { US: 'in', SI: 'mm', d: [4, 1] },
        length_ft: { US: 'ft', SI: 'm', d: [2, 3] },
        area: { US: 'in²', SI: 'mm²', d: [4, 1] },
        section_modulus: { US: 'in³', SI: 'mm³', d: [4, 0] },
        moment_of_inertia: { US: 'in⁴', SI: 'mm⁴', d: [4, 0] },
        torsion_constant: { US: 'in⁴', SI: 'mm⁴', d: [6, 0] },
        warping_constant: { US: 'in⁶', SI: 'mm⁶', d: [4, 0] },
        force_per_length: { US: 'kip/in', SI: 'kN/m', d: [4, 2] },
        rotational_stiffness: { US: 'kip-in/rad/in', SI: 'kN-m/rad/m', d: [4, 4] },
        lat_stiff: { US: 'kip/in/in', SI: 'kN/m/m', d: [4, 1] },
        pressure: { US: 'psf', SI: 'kPa', d: [1, 3] },
        per_area: { US: '1/in²', SI: '1/mm²', d: [8, 10] },
        linload: { US: 'plf', SI: 'kN/m', d: [1, 3] },
        dimensionless: { US: '', SI: '', d: [3, 3] },
        angle: { US: '°', SI: '°', d: [1, 1] },
        count: { US: '', SI: '', d: [0, 0] },
    };
    const VERDICT = { pass: ['통과', 'ok'], fail: ['불합격', 'ng'], not_evaluated: ['판정 없음', 'ne'], not_applicable: ['해당 없음', 'na'] };
    const BASIS = { fail: '불합격 항목', not_evaluated: '판정 없는 항목', ratio: '비 최대', capacity: '설계강도 최소' };

    /** 글 하나를 HTML 로(유일한 함수 — review.js 도 이것): & < > " ' 와, 글 방향 제어 문자는 보이게(표의 글이 거꾸로 읽히지 않게) */
    function esc(s) {
        return String(s == null ? '' : s).replace(/[‎‏‪-‮⁦-⁩؜]/g, '�')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    const txt = esc;
    const isQ = (c) => !!c && typeof c === 'object' && typeof c.quantity === 'string' && ('value' in c || 'unbounded' in c);
    function unitName(quantity, units) { const u = QUNIT[quantity]; return u ? u[units] : String(quantity || ''); }
    function digitsOf(q, units) {
        if (typeof q.digits === 'number') { return q.digits; }
        if (q.digits && typeof q.digits === 'object' && typeof q.digits[units] === 'number') { return q.digits[units]; }
        const u = QUNIT[q.quantity];
        return u ? u.d[units === 'SI' ? 1 : 0] : 3;
    }
    function num(v, d) {
        if (v === Infinity) { return '∞'; }
        if (typeof v !== 'number' || !isFinite(v)) { return '—'; }
        const s = v.toFixed(Math.max(0, Math.min(10, d)));
        return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s;
    }
    /** 값 하나: '12.34 kip-in' (withUnit false 면 수만) */
    function qtext(q, units, withUnit) {
        if (!q) { return '—'; }
        const v = q.unbounded === true ? '∞' : num(q.value, digitsOf(q, units));
        const u = unitName(q.quantity, units);
        return withUnit === false || !u || v === '—' ? v : v + ' ' + u;
    }
    function cell(c, units) {
        if (c == null) { return ''; }
        if (typeof c === 'string' || typeof c === 'number') { return txt(c); }
        if (isQ(c)) { return esc(qtext(c, units, c.nounit !== true)); }
        if (typeof c.unit_of === 'string') { return esc(unitName(c.unit_of, units)); }
        if (typeof c.text === 'string') { return txt(c.text); }
        return '';
    }
    function tone(t) { return t === 'ng' || t === 'warn' || t === 'ok' || t === 'ne' || t === 'muted' ? ' class="t-' + t + '"' : ''; }

    // ── 그림 ────────────────────────────────────────────────────────────────
    function svgSection(b) {
        const pts = b.nodes && Array.isArray(b.nodes.values) ? b.nodes.values : [];
        if (pts.length === 0) { return ''; }
        const xs = pts.map((p) => +p[0]), zs = pts.map((p) => +p[1]);
        const xMin = Math.min(...xs), xMax = Math.max(...xs), zMin = Math.min(...zs), zMax = Math.max(...zs);
        const span = Math.max(xMax - xMin, zMax - zMin) || 1, pad = span * 0.2;
        const sw = span * 0.012, r = span * 0.006;
        let s = '<svg width="180" height="180" viewBox="' + [xMin - pad, zMin - pad, xMax - xMin + 2 * pad, zMax - zMin + 2 * pad].map((v) => v.toFixed(4)).join(' ')
            + '" style="border:1px solid #ddd;border-radius:4px;background:#fafafa">';
        for (const e of (b.elems && Array.isArray(b.elems.values) ? b.elems.values : [])) {
            const a = pts[e[0]], c = pts[e[1]];
            if (a && c) { s += '<line x1="' + (+a[0]).toFixed(4) + '" y1="' + (+a[1]).toFixed(4) + '" x2="' + (+c[0]).toFixed(4) + '" y2="' + (+c[1]).toFixed(4) + '" stroke="#1565c0" stroke-width="' + sw.toFixed(4) + '" stroke-linecap="round"/>'; }
        }
        for (const p of pts) { s += '<circle cx="' + (+p[0]).toFixed(4) + '" cy="' + (+p[1]).toFixed(4) + '" r="' + r.toFixed(4) + '" fill="#ff9800"/>'; }
        return s + '</svg>';
    }
    function svgCurve(b, units) {
        const L = b.L && Array.isArray(b.L.values) ? b.L.values : [], F = b.LF && Array.isArray(b.LF.values) ? b.LF.values : [];
        const pts = L.map((x, i) => [+x, +F[i]]).filter((p) => p[0] > 0 && p[1] > 0 && isFinite(p[0]) && isFinite(p[1]));
        if (pts.length < 2) { return '<p>(곡선 자료 부족)</p>'; }
        const W = 500, H = 220, PL = 55, PR = 15, PT = 20, PB = 35, pw = W - PL - PR, ph = H - PT - PB;
        const lx = pts.map((p) => Math.log10(p[0])), x0 = Math.min(...lx), x1 = Math.max(...lx) === x0 ? x0 + 1 : Math.max(...lx);
        const yMax = Math.max(...pts.map((p) => p[1])) * 1.15;
        const X = (v) => PL + (Math.log10(Math.max(v, 1e-9)) - x0) / (x1 - x0) * pw, Y = (v) => PT + ph - v / yMax * ph;
        let s = '<svg width="' + W + '" height="' + H + '" style="border:1px solid #ddd;border-radius:4px;background:#fafafa">';
        s += '<rect x="' + PL + '" y="' + PT + '" width="' + pw + '" height="' + ph + '" fill="none" stroke="#ccc"/>';
        for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
            const gx = X(Math.pow(10, e)).toFixed(1);
            s += '<line x1="' + gx + '" y1="' + PT + '" x2="' + gx + '" y2="' + (PT + ph) + '" stroke="#eee" stroke-width="0.5"/>';
            s += '<text x="' + gx + '" y="' + (H - PB + 14) + '" font-size="8" text-anchor="middle" fill="#999">' + esc(String(Math.pow(10, e))) + '</text>';
        }
        s += '<path d="' + pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join('') + '" fill="none" stroke="#1565c0" stroke-width="1.5"/>';
        const colors = ['#ff5722', '#ffab00', '#7c4dff'];
        (Array.isArray(b.marks) ? b.marks : []).forEach((m, i) => {
            if (!m || !m.L || !m.LF || !(m.L.value > 0) || !(m.LF.value > 0)) { return; }
            const ex = X(m.L.value), ey = Y(m.LF.value), col = colors[i % colors.length];
            s += '<circle cx="' + ex.toFixed(1) + '" cy="' + ey.toFixed(1) + '" r="4" fill="' + col + '" stroke="#fff" stroke-width="1"/>';
            s += '<text x="' + (ex + 6).toFixed(1) + '" y="' + (ey - 6).toFixed(1) + '" font-size="8" fill="' + col + '" font-weight="600">'
                + txt(m.label) + '=' + esc(qtext(m.LF, units, false)) + ' @ L=' + esc(qtext(m.L, units)) + '</text>';
        });
        s += '<text x="' + (PL + pw / 2) + '" y="' + (H - 3) + '" font-size="9" text-anchor="middle" fill="#666">반파장 (' + esc(unitName(b.L.quantity, units)) + ')</text>';
        s += '<text x="12" y="' + (PT + ph / 2) + '" font-size="9" text-anchor="middle" fill="#666" transform="rotate(-90,12,' + (PT + ph / 2) + ')">하중계수</text>';
        return s + '</svg>';
    }
    function svgBeam(b, units) {
        const spans = b.spans && Array.isArray(b.spans.values) ? b.spans.values.map(Number) : [];
        const total = spans.reduce((a, v) => a + v, 0);
        if (!(total > 0)) { return ''; }
        const W = 480, H = 80, PL = 20, pw = W - 40, y = 18, sh = 9, fg = '#333', dim = '#777', lapC = '#4fc3f7';
        const X = (v) => PL + v / total * pw;
        const sup = [0]; spans.forEach((v, i) => sup.push(sup[i] + v));
        const lu = unitName(b.spans.quantity, units);
        let s = '<div style="margin:4px 0"><svg width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px">';
        s += '<line x1="' + X(0) + '" y1="' + y + '" x2="' + X(total).toFixed(1) + '" y2="' + y + '" stroke="' + fg + '" stroke-width="2"/>';
        (Array.isArray(b.laps) ? b.laps : []).forEach((lp, i) => {
            const l = lp && lp.left ? +lp.left.value || 0 : 0, r = lp && lp.right ? +lp.right.value || 0 : 0;
            if (!(l > 0 || r > 0) || sup[i] === undefined) { return; }
            const a = X(Math.max(0, sup[i] - l)), c = X(Math.min(total, sup[i] + r));
            s += '<line x1="' + a.toFixed(1) + '" y1="' + y + '" x2="' + c.toFixed(1) + '" y2="' + y + '" stroke="' + lapC + '" stroke-width="5" stroke-opacity="0.5"/>';
            s += '<text x="' + ((a + c) / 2).toFixed(1) + '" y="' + (y - 4) + '" fill="' + lapC + '" font-size="8" text-anchor="middle">'
                + esc(num(l + r, digitsOf(lp.left || lp.right, units)) + ' ' + lu) + ' lap</text>';
        });
        sup.forEach((v, i) => {
            const x = X(v), t = String((b.supports || [])[i] || 'P').toUpperCase().charAt(0);
            if (t === 'N') { s += '<circle cx="' + x.toFixed(1) + '" cy="' + y + '" r="3" fill="none" stroke="' + fg + '" stroke-dasharray="2,1"/>'; }
            else { s += '<polygon points="' + x.toFixed(1) + ',' + y + ' ' + (x - 6).toFixed(1) + ',' + (y + sh) + ' ' + (x + 6).toFixed(1) + ',' + (y + sh) + '" fill="' + fg + '" fill-opacity="' + (t === 'F' ? 0.8 : 0.5) + '"/>'; }
            s += '<text x="' + x.toFixed(1) + '" y="' + (y + sh + 12) + '" fill="' + dim + '" font-size="8" text-anchor="middle">' + esc(t) + '</text>';
        });
        spans.forEach((v, i) => {
            const a = X(sup[i]), c = X(sup[i + 1]), dy = y + sh + 18;
            s += '<line x1="' + a.toFixed(1) + '" y1="' + dy + '" x2="' + c.toFixed(1) + '" y2="' + dy + '" stroke="' + dim + '" stroke-width="0.8"/>';
            s += '<text x="' + ((a + c) / 2).toFixed(1) + '" y="' + (dy + 11) + '" fill="' + dim + '" font-size="9" text-anchor="middle">' + esc(qtext({ value: v, quantity: b.spans.quantity }, units)) + '</text>';
        });
        return s + '</svg></div>';
    }
    function svgDiagram(b, units) {
        const xs = b.x && Array.isArray(b.x.values) ? b.x.values.map(Number) : [];
        const ys = b.y && Array.isArray(b.y.values) ? b.y.values.map(Number) : [];
        const n = Math.min(xs.length, ys.length);
        if (n < 2) { return ''; }
        const W = 480, H = 140, PL = 6, PR = 6, PT = 22, PB = 18, pw = W - PL - PR, ph = H - PT - PB, mid = PT + ph / 2;
        const v = ys.slice(0, n).map((a) => (b.flip ? -a : a));
        const m = Math.max(...v.map(Math.abs), 1e-9), sc = ph / 2 / m;
        const xa = xs[0], xl = (xs[n - 1] - xs[0]) || 1;
        const X = (x) => PL + (x - xa) / xl * pw;
        const col = /^#[0-9a-fA-F]{3,8}$/.test(String(b.color || '')) ? b.color : '#1565c0';
        const d = v.map((a, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ',' + (mid - a * sc).toFixed(1)).join('');
        let s = '<div style="margin:4px 0"><svg width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px;border:1px solid #ddd;border-radius:3px">';
        s += '<line x1="' + PL + '" y1="' + mid + '" x2="' + (W - PR) + '" y2="' + mid + '" stroke="#999" stroke-dasharray="4"/>';
        s += '<path d="' + d + 'L' + X(xs[n - 1]).toFixed(1) + ',' + mid + 'L' + X(xs[0]).toFixed(1) + ',' + mid + 'Z" fill="' + col + '" fill-opacity="0.12"/>';
        s += '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.5"/>';
        s += '<text x="' + PL + '" y="13" fill="#333" font-size="10" font-weight="600">' + txt(b.title) + ' (' + esc(unitName(b.y.quantity, units)) + ')</text>';
        let iMax = 0, iMin = 0;
        for (let i = 1; i < n; i++) { if (v[i] > v[iMax]) { iMax = i; } if (v[i] < v[iMin]) { iMin = i; } }
        for (const i of iMax === iMin ? [iMax] : [iMax, iMin]) {
            s += '<circle cx="' + X(xs[i]).toFixed(1) + '" cy="' + (mid - v[i] * sc).toFixed(1) + '" r="2.5" fill="' + col + '"/>';
            s += '<text x="' + (X(xs[i]) + 3).toFixed(1) + '" y="' + (mid - v[i] * sc + (i === iMax ? -4 : 11)).toFixed(1) + '" fill="' + col + '" font-size="9" font-weight="600">'
                + esc(qtext({ value: ys[i], quantity: b.y.quantity }, units, false)) + '</text>';
        }
        (Array.isArray(b.marks) ? b.marks : []).forEach((mk) => {
            if (!mk || !mk.x || typeof mk.x.value !== 'number') { return; }
            const ax = X(mk.x.value);
            s += '<line x1="' + ax.toFixed(1) + '" y1="' + PT + '" x2="' + ax.toFixed(1) + '" y2="' + (PT + ph) + '" stroke="#ab47bc" stroke-opacity="0.5" stroke-dasharray="3,2"/>';
            s += '<text x="' + ax.toFixed(1) + '" y="' + (PT - 2) + '" fill="#ab47bc" font-size="7.5" text-anchor="middle">' + txt(mk.label)
                + (mk.y ? ' ' + esc(qtext(mk.y, units, false)) : '') + '</text>';
        });
        return s + '</svg></div>';
    }

    // ── 검토 항목(design_checks[*]) ───────────────────────────────────────────
    function srcText(src) {
        if (!src || typeof src !== 'object') { return ''; }
        const k = src.kind;
        const bits = {
            // 엔진의 step 은 0 부터(같은 항목 steps 의 자리) — 표의 # 는 1 부터
            step: () => '단계 ' + (typeof src.step === 'number' ? src.step + 1 : ''),
            check: () => '항목 ' + (src.id || src.group || ''),
            section_property: () => '단면 ' + (src.key || '') + (src.generated ? ' (' + (src.flags_ko && src.flags_ko.includes('템플릿으로 생성') ? '템플릿으로 생성' : '템플릿') + ')' : ''),
            material: () => '재료 ' + (src.key || ''),
            buckling_analysis: () => '좌굴 해석 ' + (src.method_ko || src.method || '') + (src.label ? ' ' + src.label : ''),
            load_analysis: () => '하중 해석' + (src.combination ? ' ' + src.combination : ''),
            user_input: () => '입력 ' + (src.key || ''),
            engine_default: () => '엔진 기본값 ' + (src.key || ''),
            specification: () => '기준 ' + [src.table, src.row, src.equation].filter(Boolean).join(' '),
        }[k];
        // K4e: 출처 메모(엔진 note — readerCheck 가 한국어 · 보이는 단위로 그려 둔 글)
        const note = typeof src.note === 'string' && src.note ? ' — ' + src.note : '';
        return (bits ? bits() : String(src.kind_ko || k || '')) + note;
    }
    function qWithSym(q, units) {
        if (!q) { return '—'; }
        return txt(q.symbol || '') + (q.symbol ? ' = ' : '') + esc(qtext(q, units));
    }
    function renderCheck(c, units) {
        if (!c || typeof c !== 'object') { return ''; }
        const v = VERDICT[c.verdict] || [String(c.verdict || '—'), 'ne'];
        let h = '<div class="chk chk-' + v[1] + '"><h4>' + txt(c.name_ko || c.name || c.id) + ' <span class="clause">'
            + txt([c.clause, Array.isArray(c.equations) && c.equations.length ? 'Eq. ' + c.equations.join(', ') : ''].filter(Boolean).join(' · '))
            + '</span> <span class="v v-' + v[1] + '">' + esc(v[0]) + '</span>'
            + (c.governs ? ' <span class="gov">지배' + (c.governs_basis ? ' — ' + esc(BASIS[c.governs_basis] || c.governs_basis) : '') + '</span>' : '')
            + '</h4><div class="chk-id">' + txt(c.id) + (c.design_method ? ' · ' + txt(c.design_method) : '') + '</div>';
        h += '<table class="chk-head"><tr><th>소요</th><th>공칭강도</th><th>계수</th><th>설계강도</th><th>비</th></tr><tr>';
        h += '<td>' + qWithSym(c.demand, units) + (c.demand && c.demand.source ? '<div class="src">' + txt(srcText(c.demand.source)) + '</div>' : '') + '</td>';
        h += '<td>' + qWithSym(c.nominal, units) + '</td>';
        h += '<td>' + (c.factor ? txt(c.factor.symbol || (c.factor.kind === 'omega' ? 'Ω' : 'φ')) + ' = ' + esc(num(c.factor.value, 2)) : '—') + '</td>';
        h += '<td>' + qWithSym(c.capacity, units) + '</td>';
        h += '<td>' + (typeof c.ratio === 'number' ? esc(num(c.ratio, 3)) : '—') + (c.ratio_form ? '<div class="src">' + txt(c.ratio_form) + '</div>' : '') + '</td>';
        h += '</tr></table>';
        const notes = [];
        if (c.reason) { notes.push(['까닭', c.reason]); }
        if (c.out_of_scope) { notes.push(['적용범위 밖', c.out_of_scope + ' — 계산한 값은 참고']); }
        // 2026-11-26: 구멍 없는 강도의 상한으로 낸 불합격(trusted false 이지만 판정이다 — member.reason.fails_without_holes)
        if (c.trusted === false && c.verdict === 'fail' && c.reason_code === 'member.reason.fails_without_holes') {
            notes.push(['구멍 없는 강도의 상한', '소요 · 설계강도 · 비는 구멍 없는 강도의 상한의 것 — 구멍 조항은 평가하지 못했지만 구멍은 강도를 낮추기만 하므로 불합격']);
        } else if (c.trusted === false) { notes.push(['믿지 않는 값', '엔진이 판정에 쓰지 않은 값']); }
        if (c.reference && typeof c.reference === 'object') {
            const r = c.reference;
            notes.push(['참고(판정에 쓰지 않음)', [r.capacity ? '설계강도 ' + qtext(r.capacity, units) : '', r.nominal ? '공칭 ' + qtext(r.nominal, units) : '',
                typeof r.ratio === 'number' ? '비 ' + num(r.ratio, 3) : ''].filter(Boolean).join(', ')]);
        }
        if (c.highest_evaluated) {
            const he = c.highest_evaluated;
            notes.push(['평가한 항목 가운데 비 최대', (he.id || '') + (typeof he.ratio === 'number' ? ' ' + num(he.ratio, 3) : '') + (he.verdict ? ' (' + ((VERDICT[he.verdict] || [he.verdict])[0]) + ')' : '')]);
        }
        if (c.combination) { notes.push(['하중 조합', c.combination]); }
        if (c.location && typeof c.location === 'object') {
            const L = c.location;
            notes.push(['위치', [L.region, L.check_point, L.segment, L.span != null ? '경간 ' + L.span : '', L.support != null ? '지점 ' + L.support : '',
                L.x ? 'x = ' + qtext(L.x, units) : ''].filter(Boolean).join(' · ')]);
        }
        if (c.steps_unavailable) { notes.push(['계산 과정 없음', c.steps_unavailable]); }
        if (notes.length) { h += '<ul class="chk-notes">' + notes.map((n) => '<li><b>' + esc(n[0]) + '</b>: ' + txt(n[1]) + '</li>').join('') + '</ul>'; }
        const steps = Array.isArray(c.steps) ? c.steps : [];
        if (steps.length) {
            h += '<table class="steps"><tr><th>#</th><th>식</th><th>입력</th><th>결과</th></tr>';
            steps.forEach((s, i) => {
                if (!s || typeof s !== 'object') { return; }
                let ex = '';
                if (s.kind === 'branch') {
                    ex = txt(s.condition || '') + ' → ' + (s.holds ? '참' : '거짓') + (s.equation ? ' → Eq. ' + txt(s.equation) : '');
                } else {
                    ex = txt(s.expr || '') + (s.equation ? ' <span class="eqn">(Eq. ' + txt(s.equation) + ')</span>' : '');
                }
                if (s.expr_units === 'US' && units === 'SI') { ex += '<div class="us-eq">US 단위로 쓴 식 — ' + txt(s.units_note || '') + '</div>'; }
                if (s.note) { ex += '<div class="src">' + txt(s.note) + '</div>'; }
                const ins = (Array.isArray(s.inputs) ? s.inputs : []).map((q) => qWithSym(q, units) + (q && q.source ? ' <span class="src">[' + txt(srcText(q.source)) + ']</span>' : '')).join('<br>');
                const res = s.result ? qWithSym(s.result, units) : (s.verdict ? esc((VERDICT[s.verdict] || [s.verdict])[0]) : '');
                h += '<tr><td>' + (i + 1) + '</td><td>' + ex + '</td><td>' + ins + '</td><td>' + res + '</td></tr>';
            });
            h += '</table>';
        }
        return h + '</div>';
    }

    // ── 블록 · 문서 ──────────────────────────────────────────────────────────
    function renderBlock(b, units) {
        if (!b || typeof b !== 'object') { return ''; }
        switch (b.kind) {
            case 'table': {
                let h = '<table>' + (Array.isArray(b.head) ? '<tr>' + b.head.map((x) => '<th>' + cell(x, units) + '</th>').join('') + '</tr>' : '');
                for (const r of (Array.isArray(b.rows) ? b.rows : [])) {
                    if (!Array.isArray(r)) { continue; }
                    h += '<tr>' + r.map((x) => '<td' + (x && typeof x === 'object' ? tone(x.tone) : '') + '>' + cell(x, units) + '</td>').join('') + '</tr>';
                }
                return h + '</table>' + (b.note ? '<p class="note">' + txt(b.note) + '</p>' : '');
            }
            case 'para': return '<p' + tone(b.tone) + '>' + txt(b.text) + '</p>';
            case 'heading': return '<h3>' + txt(b.text) + '</h3>';
            case 'list': {
                const items = (Array.isArray(b.items) ? b.items : []).filter((x) => x != null && String(x) !== '');
                if (!items.length) { return ''; }
                // K4b: 목록의 어조는 같은 class 속성 안에(전: class 가 두 번 — 둘째는 버려져 어조가 보이지 않았다)
                return '<div class="list' + (tone(b.tone) ? ' t-' + b.tone : '') + '"><b>' + txt(b.title) + '</b><ul>' + items.map((x) => '<li>' + txt(typeof x === 'string' ? x : JSON.stringify(x)) + '</li>').join('') + '</ul></div>';
            }
            case 'check': return renderCheck(b.check, units);
            case 'section': return '<div class="section-fig">' + svgSection(b) + '</div>';
            case 'curve': return '<div class="section-fig">' + svgCurve(b, units) + '</div>';
            case 'beam': return svgBeam(b, units);
            case 'diagram': return svgDiagram(b, units);
            // 화면 캔버스의 PNG 만(data:image/png;base64 — 다른 주소 · 형식은 그리지 않는다)
            case 'image': return /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(String(b.src || '')) ? '<div class="chart"><img src="' + b.src + '"></div>' : '';
            default: return '';
        }
    }
    const STYLE = '<style>.chk{border:1px solid #ddd;border-left:4px solid #999;padding:4px 8px;margin:6px 0}.chk-ok{border-left-color:#2e7d32}'
        + '.chk-ng{border-left-color:#c62828}.chk-ne{border-left-color:#ef6c00}.chk-na{border-left-color:#bbb}.chk h4{margin:2px 0}'
        + '.clause{color:#555;font-weight:400}.v{font-size:10px;padding:0 4px;border-radius:2px}.v-ok{background:#e8f5e9}.v-ng{background:#ffebee}'
        + '.v-ne{background:#fff3e0}.gov{font-size:10px;color:#1565c0}.chk-id,.src,.eqn{font-size:9px;color:#777}.us-eq{font-size:9px;color:#b36b00}'
        + '.t-ng{color:#c62828;font-weight:600}.t-ok{color:#2e7d32}.t-ne,.t-warn{color:#ef6c00}.t-muted{color:#777}.note{font-size:10px;color:#555}</style>';

    /** ReportDoc → HTML(보고서 몸 — 인쇄 틀은 review.printableReportHtml) */
    function renderReportDoc(doc) {
        if (!doc || typeof doc !== 'object' || doc.schema !== 'stcfsd-report/1') { return ''; }
        const units = doc.meta && doc.meta.units === 'SI' ? 'SI' : 'US';
        const m = doc.meta || {};
        let h = STYLE;
        const st = m.stamp;
        if (st && typeof st === 'object' && (st.kind === 'draft' || st.kind === 'issued')) {
            const parts = [st.kind === 'issued' ? '발행' : '초안'];
            if (st.label) { parts.push(txt(st.label)); }
            if (st.notChecked) { parts.push('확인 안 함'); }
            if (st.reviewer) { parts.push('검토 ' + txt(st.reviewer)); }
            if (st.date) { parts.push(txt(st.date)); }
            const color = st.kind === 'issued' ? '#2e7d32' : '#e65100';
            h += '<div class="report-stamp report-stamp-' + st.kind + '" style="border:1px solid ' + color + ';color:' + color
                + ';font-size:10px;padding:2px 6px;margin-bottom:8px">' + parts.join(' · ') + '</div>'
                + '<style>@media print{.report-stamp{position:fixed;top:0;right:0;background:#fff}}</style>';
        }
        h += '<h1>' + txt(m.title || '냉간성형강 설계 보고서') + '</h1>';
        h += '<table style="border:none"><tr style="border:none"><td style="border:none;width:50%">날짜: ' + txt(m.date || '') + '</td>'
            + '<td style="border:none;text-align:right">' + txt([m.spec, m.method, m.design_method, units === 'SI' ? 'SI 단위' : 'US 단위'].filter(Boolean).join(' / ')) + '</td></tr></table><hr>';
        (Array.isArray(doc.sections) ? doc.sections : []).forEach((s, i) => {
            if (!s || typeof s !== 'object') { return; }
            h += '<h2>' + (i + 1) + '. ' + txt(s.title) + '</h2>';
            for (const b of (Array.isArray(s.blocks) ? s.blocks : [])) { h += renderBlock(b, units); }
        });
        h += '<hr><p style="text-align:center;color:#999;font-size:9px">StCFSD 냉간성형강 단면 설계 — ' + txt(m.spec || 'AISI S100-16') + '</p>';
        return h;
    }

    return { renderReportDoc, renderBlock, renderCheck, qtext, esc, QUNIT };
}));
