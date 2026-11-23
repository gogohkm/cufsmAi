/**
 * K4b — 엔진 알림의 경계(계약 docs/implementation/20261123-check-contract.md §16). 화면 · 검증 목록 · 보고서 · MCP 요약이 같은 함수로 그린다.
 *
 *  - render(notice, {units, lang}): 알림 하나(`{code, kind, template, template_ko, params, prefix?, parts?, …}`)를 글로.
 *    US 는 엔진의 `text` · `text_ko` 와 글자까지 같다(`notice-template/1`, 고정값 test/python/notice_render_fixture.json).
 *    SI 는 물리량(`quantity`) 매개변수를 바꾸고 SI 단위 글자를 쓴다 — 자리수는 여기서 정한다(엔진의 fmt 는 US 의 것).
 *    템플릿 글 자체에 박힌 US 상수(「0.60 in」 「95 ksi」 「33 ft」)도 SI 로 바꾼다 — SI 로 읽는 문장에 US 수가 남지 않게.
 *    `quantity: null` 매개변수는 단위계와 무관하게 받은 그대로.
 *  - reason(check, opts): 검토 항목의 이유(`reason_*`)를 같은 규칙으로. 없으면 옛 `reason` 글.
 *  - lines(result, opts): 결과 맨 위의 알림(`notices`)을 목록 차례대로 `{list, code, kind, text}` — 알림이 없는 옛 글(호스트가 더한 것)은 code null 로 뒤에.
 *  - localize(tree, units): MCP 의 `detail: 'full'` SI 응답 — 알림 · 이유 · 옛 글 목록의 글을 SI 로 다시 그리고 매개변수의 단위 글자를 SI 로
 *    (값은 그 뒤 siUnits 의 걸음이 quantity 로 바꾼다).
 *  - fastenerLabel(parts, opts): 랩 패스너 이름표(`fastener_label_parts`).
 * 말: 사람과 AI 가 읽는 것은 한국어(`lang: 'ko'`, 기본) — 오케스트레이터 결정(K4b). 영어 글은 결과에 그대로 남는다.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else { root.StcfsdNotices = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ── 물리량(계약 §3.2 + mass_density) — US → SI 계수(정의값), SI 글자, SI 기본 자리수 ──────────────────
    const KIP_KN = 4.4482216152605, IN_MM = 25.4, IN_M = 0.0254, FT_M = 0.3048;
    const Q = {
        length: { f: IN_MM, si: 'mm', d: 1 },
        area: { f: IN_MM * IN_MM, si: 'mm²', d: 0 },
        section_modulus: { f: Math.pow(IN_MM, 3), si: 'mm³', d: 0 },
        moment_of_inertia: { f: Math.pow(IN_MM, 4), si: 'mm⁴', d: 0 },
        torsion_constant: { f: Math.pow(IN_MM, 4), si: 'mm⁴', d: 0 },
        warping_constant: { f: Math.pow(IN_MM, 6), si: 'mm⁶', d: 0 },
        force: { f: KIP_KN, si: 'kN', d: 2 },
        moment: { f: KIP_KN * IN_M, si: 'kN-m', d: 2 },
        stress: { f: KIP_KN * 1000 / (IN_MM * IN_MM), si: 'MPa', d: 1 },
        force_per_length: { f: KIP_KN / IN_M, si: 'kN/m', d: 2 },
        rotational_stiffness: { f: KIP_KN, si: 'kN-m/rad/m', d: 3 },
        // 계약 §16.7 의 후보 — 1 kip·s²/in⁴ = 4448.2216 N·s² / (0.0254 m)⁴ ≈ 1.06870 × 10¹⁰ kg/m³
        mass_density: { f: KIP_KN * 1000 / Math.pow(IN_M, 4), si: 'kg/m³', d: 0 },
    };
    const UNCHANGED = { dimensionless: 1, count: 1, angle: 1 };
    // 템플릿 글에 박힌 US 상수 → 물리량
    const LITERAL_UNITS = { 'in': 'length', 'in.': 'length', 'ksi': 'stress', 'kip': 'force', 'kips': 'force', 'kip-in': 'moment', 'ft': 'length_ft' };

    function isDimensional(q) { return typeof q === 'string' && Object.prototype.hasOwnProperty.call(Q, q); }

    /** SI 값의 자리수 — 물리량의 기본 자리수, 유효숫자가 셋보다 적으면 늘린다(6 까지) */
    function siFixed(v, d0) {
        let d = d0;
        const a = Math.abs(v);
        while (a > 0 && a < Math.pow(10, 2 - d) && d < 6) { d++; }
        return fixed(v, d);
    }

    // ── Python 의 format · repr · str ─────────────────────────────────────────────
    /** Python repr(float) — 가장 짧은 왕복 자리, 지수는 −4 ≤ e < 16 밖에서 e±XX */
    function reprFloat(x) {
        if (Number.isNaN(x)) { return 'nan'; }
        if (!isFinite(x)) { return x > 0 ? 'inf' : '-inf'; }
        if (x === 0) { return Object.is(x, -0) ? '-0.0' : '0.0'; }
        const parts = Math.abs(x).toExponential().split('e');
        const n = Number(parts[1]);
        const digits = parts[0].replace('.', '');
        let s;
        if (n >= -4 && n < 16) {
            if (n >= digits.length - 1) { s = digits + '0'.repeat(n - (digits.length - 1)) + '.0'; }
            else if (n >= 0) { s = digits.slice(0, n + 1) + '.' + digits.slice(n + 1); }
            else { s = '0.' + '0'.repeat(-n - 1) + digits; }
        } else {
            s = (digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits) + 'e' + (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0');
        }
        return (x < 0 ? '-' : '') + s;
    }
    /** Python str/repr — 수(정수 꼴이면 intForm 이 정한다), 글, 목록, 참 · 거짓, None */
    function pyStr(v, intForm, quoteStrings) {
        if (v === null || v === undefined) { return 'None'; }
        if (typeof v === 'boolean') { return v ? 'True' : 'False'; }
        if (typeof v === 'number') { return Number.isInteger(v) && intForm ? String(v) : reprFloat(v); }
        if (typeof v === 'string') { return quoteStrings ? pyQuote(v) : v; }
        if (Array.isArray(v)) { return '[' + v.map((x) => pyStr(x, Number.isInteger(x), true)).join(', ') + ']'; }
        if (typeof v === 'object') { return '{' + Object.keys(v).map((k) => pyQuote(k) + ': ' + pyStr(v[k], Number.isInteger(v[k]), true)).join(', ') + '}'; }
        return String(v);
    }
    function pyQuote(s) {
        const q = s.includes("'") && !s.includes('"') ? '"' : "'";
        return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\n/g, '\\n') + q;
    }
    /** Python format(x, '.Nf') — 정확한 2진 값의 반올림, 꼭 가운데면 짝수 쪽(JS toFixed 는 큰 쪽) */
    function fixed(x, d) {
        if (!isFinite(x)) { return reprFloat(x); }
        const neg = x < 0 || Object.is(x, -0);
        const ax = Math.abs(x);
        let s = ax.toFixed(d);
        const long = ax.toFixed(Math.min(100, d + 60));
        const dot = long.indexOf('.');
        const tail = long.slice(dot + 1 + d);
        if (/^50*$/.test(tail)) {
            // 꼭 가운데 — 짝수 쪽으로(Python)
            const down = long.slice(0, d === 0 ? dot : dot + 1 + d);
            if (Number(down.slice(-1)) % 2 === 0) { s = down; }
        }
        return (neg ? '-' : '') + s;
    }
    function gFormat(x, p, alt) {
        if (!isFinite(x)) { return reprFloat(x); }
        if (p === 0) { p = 1; }
        if (x === 0) { return Object.is(x, -0) ? '-0' : '0'; }
        const e = Number(x.toExponential(p - 1).split('e')[1]);
        let s;
        if (e >= -4 && e < p) { s = fixed(x, p - 1 - e); if (!alt && s.includes('.')) { s = s.replace(/0+$/, '').replace(/\.$/, ''); } }
        else {
            const m = x.toExponential(p - 1).split('e');
            let mant = m[0];
            if (!alt && mant.includes('.')) { mant = mant.replace(/0+$/, '').replace(/\.$/, ''); }
            const n = Number(m[1]);
            s = mant + 'e' + (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0');
        }
        return s;
    }
    /** Python format(value, spec) — spec: '' · '.Nf' · '.Ng' · 'g' · '.Ne' */
    function pyFormat(v, spec, intForm) {
        if (typeof v !== 'number') { return pyStr(v, intForm); }
        if (!spec) { return pyStr(v, intForm); }
        let m = /^\.(\d+)f$/.exec(spec);
        if (m) { return fixed(v, Number(m[1])); }
        m = /^(?:\.(\d+))?g$/.exec(spec);
        if (m) {
            return gFormat(v, m[1] === undefined ? 6 : Number(m[1]), false);
        }
        m = /^\.(\d+)e$/.exec(spec);
        if (m) { const t = v.toExponential(Number(m[1])).split('e'); const n = Number(t[1]); return t[0] + 'e' + (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0'); }
        return pyStr(v, intForm);
    }

    // ── 그리기 ────────────────────────────────────────────────────────────────
    /** 매개변수 하나 — US 면 엔진과 같게, SI 면 물리량을 바꿔서 */
    function renderParam(p, units, lang, intForm) {
        if (!p || typeof p !== 'object') { return ''; }
        if (p.notice && typeof p.notice === 'object') { return render(p.notice, { units, lang }); }
        let v = p.value;
        const unitText = typeof p.unit_text === 'string' && p.unit_text ? p.unit_text : '';
        const sep = typeof p.sep === 'string' ? p.sep : '';
        if (units === 'SI' && isDimensional(p.quantity) && typeof v === 'number' && isFinite(v)) {
            const q = Q[p.quantity];
            const vs = v * q.f;
            const s = /g$|e$/.test(p.fmt || '') ? pyFormat(vs, p.fmt, false) : siFixed(vs, q.d);
            return s + (unitText ? sep : (sep || ' ')) + q.si;
        }
        let s;
        if (p.fmt === 'raw') { s = typeof p.text === 'string' ? p.text : pyStr(v, intForm); }
        else {
            if (p.conv === 'r' || p.conv === 's') { v = pyStr(v, intForm, p.conv === 'r'); }
            s = pyFormat(v, p.fmt || '', intForm);
        }
        // 글 매개변수(목록 · 문장 조각) 안에 박힌 US 수(「KtLt=120 in」)도 SI 로 — 오케스트레이터 결정(SI 로 읽는 글에 US 수가 남지 않는다).
        // 단위 글자가 따로 붙은 물리량 없는 수(quantity null + unit_text — 'ft' · 'kip*s^2/in^4')는 계약 §16.3 대로 그대로
        if (units === 'SI' && typeof p.value === 'string' && !unitText) { s = literalToSI(s); }
        return s + (unitText ? sep + unitText : '');
    }

    /** 템플릿 글 조각의 US 상수 → SI(「0.60 in」 → 「15.2 mm」) */
    const NUM = '(\\d+/\\d+|\\d+(?:\\.\\d+)?)';
    const UNIT = '(kip-in|kips|kip|ksi|ft|in\\.?)(?![A-Za-z0-9*·^/])(?!\\s+[a-z])';
    // 앞 글자: 글자 · 숫자 · 소수점 · 분수 · 지수(7.345e-7)의 일부가 아닐 것
    const PRE = '(^|[^A-Za-z0-9_./+\\-])';
    // 범위(「0.08 ≤ d ≤ 0.25 in」 「0.024 ≤ t < 0.1875 in」 「4–8 in」)는 앞의 수도 같은 단위로
    const RANGE_RE = new RegExp(PRE + NUM + '(\\s*(?:≤|<|–|~|-)\\s*(?:[A-Za-z][A-Za-z0-9_\']{0,3}\\s*(?:≤|<)\\s*)?)' + NUM + '\\s?' + UNIT, 'g');
    const ONE_RE = new RegExp(PRE + NUM + '\\s?' + UNIT, 'g');
    function numOf(s) { const m = /^(\d+)\/(\d+)$/.exec(s); return m ? Number(m[1]) / Number(m[2]) : Number(s); }
    function litSI(num, unit) {
        const q = LITERAL_UNITS[unit];
        if (q === 'length_ft') { return { v: siFixed(numOf(num) * FT_M, 2), u: 'm' }; }
        const d = Q[q];
        return { v: siFixed(numOf(num) * d.f, d.d), u: d.si };
    }
    function literalToSI(text) {
        return text
            .replace(RANGE_RE, (all, pre, a, mid, b, unit) => {
                if (!LITERAL_UNITS[unit]) { return all; }
                // 범위의 두 수는 같은 자리수로(작은 쪽이 정한 자리)
                const A = litSI(a, unit), B = litSI(b, unit);
                const dec = (x) => (x.includes('.') ? x.split('.')[1].length : 0);
                const d = Math.max(dec(A.v), dec(B.v));
                const fx = (num) => { const q = LITERAL_UNITS[unit]; return fixed(numOf(num) * (q === 'length_ft' ? FT_M : Q[q].f), d); };
                return pre + fx(a) + mid + fx(b) + ' ' + B.u + (unit === 'in.' ? '.' : '');
            })
            .replace(ONE_RE, (all, pre, num, unit) => {
                if (!LITERAL_UNITS[unit]) { return all; }
                const A = litSI(num, unit);
                return pre + A.v + ' ' + A.u + (unit === 'in.' ? '.' : '');
            });
    }

    /** 템플릿을 매개변수로 채운다 — `{name}` · `{{` · `}}` */
    function fill(template, params, units, lang, intForms) {
        const byName = {};
        (params || []).forEach((p) => { if (p && typeof p.symbol === 'string') { byName[p.symbol] = p; } });
        let out = '';
        let i = 0;
        const t = String(template);
        let literal = '';
        const flush = () => { out += units === 'SI' ? literalToSI(literal) : literal; literal = ''; };
        while (i < t.length) {
            const c = t[i];
            if (c === '{' && t[i + 1] === '{') { literal += '{'; i += 2; continue; }
            if (c === '}' && t[i + 1] === '}') { literal += '}'; i += 2; continue; }
            if (c === '{') {
                const j = t.indexOf('}', i);
                const name = t.slice(i + 1, j);
                flush();
                const p = byName[name];
                out += p ? renderParam(p, units, lang, intForms ? !!intForms[name] : intDefault(p)) : '{' + name + '}';
                i = j + 1;
                continue;
            }
            literal += c;
            i++;
        }
        flush();
        return out;
    }
    /** 정수 꼴 값을 정수로 쓸지(Python int) — JSON 이 3.0 과 3 을 가르지 못한다. 개수 · 글 매개변수 · conv 없는 차원 없는 수는 정수로 */
    function intDefault(p) {
        return p.quantity === 'count' || p.quantity === null || p.quantity === undefined;
    }
    /** 정수 꼴 매개변수(모호한 것)의 조합 가운데 엔진의 글과 같아지는 것을 고른다 — US 를 글자까지 같게 */
    function fillMatching(template, params, units, lang, want) {
        const amb = (params || []).filter((p) => p && !p.notice && typeof p.value === 'number' && Number.isInteger(p.value)
            && p.fmt !== 'raw' && (!p.fmt || p.fmt === 'g'));
        if (!amb.length || typeof want !== 'string' || units !== 'US' || amb.length > 6) { return fill(template, params, units, lang, null); }
        const first = fill(template, params, units, lang, null);
        if (first === want) { return first; }
        for (let mask = 0; mask < (1 << amb.length); mask++) {
            const forms = {};
            amb.forEach((p, k) => { forms[p.symbol] = !!(mask & (1 << k)); });
            (params || []).forEach((p) => { if (p && !(p.symbol in forms)) { forms[p.symbol] = intDefault(p); } });
            const s = fill(template, params, units, lang, forms);
            if (s === want) { return s; }
        }
        return first;
    }

    /**
     * 알림 하나 → 글. opts.units 'US' | 'SI'(기본 US), opts.lang 'ko'(기본) | 'en'(옛 글 — `template` · `text`).
     * 템플릿이 없는 알림(등록되지 않은 글 code null)은 그 글 그대로(SI 면 글 안의 US 상수만 바꾼다).
     */
    function render(n, opts) {
        const units = opts && opts.units === 'SI' ? 'SI' : 'US';
        const ko = !(opts && opts.lang === 'en');
        if (n === null || n === undefined) { return ''; }
        if (typeof n === 'string') { return units === 'SI' ? literalToSI(n) : n; }
        const prefix = ko ? (n.prefix_ko !== undefined ? n.prefix_ko : n.prefix) : n.prefix;
        if (n.kind === 'group' && Array.isArray(n.parts)) {
            return (prefix || '') + n.parts.map((p) => render(p, { units, lang: ko ? 'ko' : 'en' })).join(typeof n.sep === 'string' ? n.sep : '; ');
        }
        const template = ko ? n.template_ko : n.template;
        if (typeof template !== 'string') {
            const raw = ko ? (n.text_ko !== undefined ? n.text_ko : n.text) : n.text;
            return render(typeof raw === 'string' ? raw : '', { units });
        }
        const want = ko ? n.text_ko : n.text;
        const body = typeof want === 'string' && typeof prefix === 'string' && want.startsWith(prefix) ? want.slice(prefix.length) : want;
        return (prefix || '') + fillMatching(template, n.params, units, ko ? 'ko' : 'en', body);
    }

    /** 검토 항목의 이유 → 글(같은 규칙). 구조가 없으면 옛 글(한국어면 reason_ko) */
    function reasonNotice(c) {
        if (!c || (c.reason === undefined && c.reason_ko === undefined)) { return null; }
        return {
            code: c.reason_code !== undefined ? c.reason_code : null, kind: c.reason_kind,
            template: c.reason_template, template_ko: c.reason_template_ko, params: c.reason_params,
            parts: c.reason_parts, sep: c.reason_sep, prefix: c.reason_prefix, prefix_ko: c.reason_prefix_ko,
            text: c.reason, text_ko: c.reason_ko !== undefined ? c.reason_ko : c.reason,
        };
    }
    function reason(c, opts) {
        const n = reasonNotice(c);
        if (!n) { return null; }
        if (n.kind === 'group' || typeof n.template === 'string' || typeof n.template_ko === 'string') { return render(n, opts); }
        const ko = !(opts && opts.lang === 'en');
        return render(String((ko ? n.text_ko : n.text) || ''), opts);
    }

    const LISTS = ['warnings', 'assumptions', 'scope_notes', 'not_evaluated'];
    /** 엔진의 알림 목록인가(호스트가 같은 이름으로 쓰는 글 목록 — 예 generate_report 의 notices — 과 가른다) */
    const isNotices = (v) => Array.isArray(v) && v.some((n) => n && typeof n === 'object' && ('template' in n || 'template_ko' in n || n.kind === 'group' || 'list' in n));
    const LIST_KIND = { warnings: 'warning', assumptions: 'assumption', scope_notes: 'scope', not_evaluated: 'not_evaluated' };
    const textOf = (x) => (typeof x === 'string' ? x : (x && typeof x === 'object' && typeof x.reason === 'string' ? x.reason : null));

    /**
     * 결과 맨 위의 알림 → [{list, code, kind, text}] (목록 차례: warnings · assumptions · scope_notes · not_evaluated).
     * 알림이 옛 글과 하나씩 맞으면 알림을 그리고, 알림에 없는 옛 글(호스트가 더한 것)은 code null 로 그 목록 끝에.
     * opts.lists 로 목록을 고른다.
     */
    function lines(result, opts) {
        const out = [];
        if (!result || typeof result !== 'object') { return out; }
        const want = opts && Array.isArray(opts.lists) ? opts.lists : LISTS;
        const notices = isNotices(result.notices) ? result.notices : [];
        for (const list of want) {
            const old = Array.isArray(result[list]) ? result[list] : [];
            const mine = notices.filter((n) => n && n.list === list);
            let k = 0;
            old.forEach((o) => {
                const t = textOf(o);
                const n = mine[k];
                if (n && (t === null || t === n.text || (typeof o === 'object' && o && n.subject !== undefined))) {
                    k++;
                    const subject = o && typeof o === 'object' && typeof o.name === 'string' ? o.name : (n.subject || null);
                    out.push({ list, code: n.code !== undefined ? n.code : null, kind: n.kind || LIST_KIND[list], text: render(n, opts), ...(subject ? { subject } : {}) });
                } else if (t !== null) {
                    out.push({ list, code: null, kind: LIST_KIND[list], text: render(t, opts), ...(o && typeof o === 'object' && typeof o.name === 'string' ? { subject: o.name } : {}) });
                }
            });
            // 옛 목록이 없는(알림만 있는) 경우
            if (!(list in result)) { mine.forEach((n) => out.push({ list, code: n.code !== undefined ? n.code : null, kind: n.kind || LIST_KIND[list], text: render(n, opts) })); }
        }
        return out;
    }
    /** 한 목록의 글만(옛 글 목록 자리에 그대로 놓을 수 있게) */
    function texts(result, list, opts) { return lines(result, { ...(opts || {}), lists: [list] }).map((l) => l.text); }

    /** 랩 패스너 이름표 — `fastener_label_parts {template, template_ko, params, values}` */
    function fastenerLabel(parts, opts, fallback) {
        if (!parts || typeof parts !== 'object' || (typeof parts.template !== 'string' && typeof parts.template_ko !== 'string')) { return fallback || ''; }
        return render({ kind: 'label', template: parts.template, template_ko: parts.template_ko || parts.template, params: parts.params, text: fallback, text_ko: fallback }, opts);
    }

    /**
     * MCP detail 'full' · SI: 나무 안의 알림 · 이유 · 옛 글 목록의 글을 SI 로 다시 그리고, 매개변수의 단위 글자를 SI 로(값은 siUnits 가 바꾼다).
     * US 면 아무것도 하지 않는다. 제자리에서 바꾸지 않고 새 나무를 돌려준다.
     */
    function localize(tree, units) {
        if (units !== 'SI') { return tree; }
        const seen = new WeakMap();
        const isNotice = (o) => o && typeof o === 'object' && !Array.isArray(o) && ('template' in o || 'template_ko' in o || o.kind === 'group') && ('text' in o || 'text_ko' in o) && ('code' in o);
        function paramsSI(ps) {
            return Array.isArray(ps) ? ps.map((p) => {
                if (!p || typeof p !== 'object') { return p; }
                const o = { ...p };
                if (o.notice) { o.notice = walk(o.notice); }
                if (isDimensional(o.quantity) && typeof o.value === 'number') {
                    o.unit_text = Q[o.quantity].si;
                    if (!o.sep) { o.sep = ' '; }
                    if (o.fmt && !/g$|e$/.test(o.fmt)) { o.fmt = ''; }
                }
                return o;
            }) : ps;
        }
        function walk(o) {
            if (Array.isArray(o)) { return o.map(walk); }
            if (!o || typeof o !== 'object') { return o; }
            if (seen.has(o)) { return seen.get(o); }
            const out = {};
            seen.set(o, out);
            for (const k of Object.keys(o)) { out[k] = walk(o[k]); }
            if (isNotice(o)) {
                out.text = render(o, { units: 'SI', lang: 'en' });
                out.text_ko = render(o, { units: 'SI', lang: 'ko' });
                if (Array.isArray(o.params)) { out.params = paramsSI(o.params); }
                out.units = 'SI';
            }
            if (o.reason_template !== undefined || o.reason_template_ko !== undefined || o.reason_kind === 'group') {
                out.reason = reason(o, { units: 'SI', lang: 'en' });
                out.reason_ko = reason(o, { units: 'SI', lang: 'ko' });
                if (Array.isArray(o.reason_params)) { out.reason_params = paramsSI(o.reason_params); }
            }
            if (isNotices(o.notices)) {
                // 옛 글 목록도 같은 글로(하나씩 맞는 것만 — 호스트가 더한 글은 그 안의 US 상수만)
                for (const list of LISTS) {
                    if (!Array.isArray(o[list])) { continue; }
                    const mine = o.notices.filter((n) => n && n.list === list);
                    let k = 0;
                    out[list] = o[list].map((x) => {
                        const t = textOf(x);
                        const n = mine[k];
                        if (n && t === n.text) { k++; const s = render(n, { units: 'SI', lang: 'en' }); return typeof x === 'string' ? s : { ...walk(x), reason: s }; }
                        return typeof x === 'string' ? literalToSI(x) : walk(x);
                    });
                }
            }
            if (o.fastener_label_parts && typeof o.fastener_label === 'string') {
                out.fastener_label = fastenerLabel(o.fastener_label_parts, { units: 'SI', lang: 'en' }, o.fastener_label);
            }
            return out;
        }
        return walk(tree);
    }

    /** §I6.2.1 조건(`conditions[]` 의 value · limits — value_quantity 로) → SI. as_length 는 {value, quantity} 라 siUnits 가 바꾼다 */
    function i621ToSI(c) {
        if (!c || typeof c !== 'object' || !isDimensional(c.value_quantity)) { return c; }
        const q = Q[c.value_quantity];
        const conv = (v) => (typeof v === 'number' ? v * q.f : v);
        return { ...c, value: conv(c.value), ...(Array.isArray(c.limits) ? { limits: c.limits.map((l) => (l && typeof l === 'object' ? { ...l, value: conv(l.value) } : l)) } : {}),
            value_unit_text: q.si };
    }

    const REASON_KEYS = ['reason_template', 'reason_template_ko', 'reason_params', 'reason_parts', 'reason_sep', 'reason_prefix', 'reason_prefix_ko', 'reason_ko', 'reason_kind'];
    /**
     * AI · 사람이 읽는 요약(MCP summary · checks): 알림 · 이유 · 이름표를 한국어로, 요청한 단위로 그린 글만 남긴다(결정 K4b — code 는 함께).
     * 옛 글 목록의 항목은 code 가 있으면 {code, text}, 없으면 글. 검토 항목: reason = 한국어 이유 + reason_code, 영어 이름(name)은 뺀다(name_ko).
     * detail 'full' 은 두 말 모두 — SI 면 localize 로 글을 SI 로 다시 그린다. 새 나무를 돌려준다.
     */
    function forReader(tree, opts) {
        const units = opts && opts.units === 'SI' ? 'SI' : 'US';
        const full = opts && opts.detail === 'full';
        const fixI621 = (o) => {
            if (units !== 'SI' || !o || typeof o !== 'object') { return o; }
            const walkI = (x) => {
                if (Array.isArray(x)) { return x.map(walkI); }
                if (!x || typeof x !== 'object') { return x; }
                const out = {};
                for (const k of Object.keys(x)) { out[k] = k === 'conditions' && Array.isArray(x[k]) ? x[k].map(i621ToSI) : walkI(x[k]); }
                return out;
            };
            return walkI(o);
        };
        if (full) { return fixI621(localize(tree, units)); }
        const ro = { units, lang: 'ko' };
        // 알림이 붙지 않은 하위 묶음(하중 해석의 auto_params …)의 옛 글도 같은 글의 알림으로 그린다 — 나무 안의 알림을 글로 찾는다
        const byText = new Map();
        const gather = (o, depth) => {
            if (!o || typeof o !== 'object' || depth > 40) { return; }
            if (Array.isArray(o)) { o.forEach((x) => gather(x, depth + 1)); return; }
            if (isNotices(o.notices)) { o.notices.forEach((n) => { if (n && typeof n.text === 'string' && !byText.has(n.text)) { byText.set(n.text, n); } }); }
            for (const k of Object.keys(o)) { if ((k !== 'notices' || !isNotices(o[k])) && o[k] && typeof o[k] === 'object') { gather(o[k], depth + 1); } }
        };
        gather(tree, 0);
        const asItem = (n) => { const s = render(n, ro); return n.code ? { code: n.code, text: s } : s; };
        const loose = (x) => {
            if (typeof x === 'string') { const n = byText.get(x); return n ? asItem(n) : render(x, ro); }
            return walk(x);
        };
        const seen = new WeakMap();
        function walk(o) {
            if (Array.isArray(o)) { return o.map(walk); }
            if (!o || typeof o !== 'object') { return o; }
            if (seen.has(o)) { return seen.get(o); }
            const out = {};
            seen.set(o, out);
            for (const k of Object.keys(o)) { if (k !== 'notices' || !isNotices(o[k])) { out[k] = walk(o[k]); } }
            if (isNotices(o.notices)) {
                for (const list of LISTS) {
                    if (!Array.isArray(o[list])) { continue; }
                    const mine = o.notices.filter((n) => n && n.list === list);
                    let k = 0;
                    out[list] = o[list].map((x) => {
                        const t = textOf(x);
                        const n = mine[k];
                        if (n && t === n.text) {
                            k++;
                            const item = asItem(n);
                            return typeof x === 'string' ? item : { ...(typeof item === 'string' ? { text: item } : item), ...(typeof x.name === 'string' ? { name: x.name } : {}) };
                        }
                        return loose(x);
                    });
                }
            } else {
                for (const list of LISTS) {
                    if (Array.isArray(o[list])) { out[list] = o[list].map(loose); }
                }
            }
            if (o.reason_template !== undefined || o.reason_template_ko !== undefined || o.reason_kind === 'group' || o.reason_ko !== undefined) {
                out.reason = reason(o, ro);
                for (const k of REASON_KEYS) { delete out[k]; }
            } else if (typeof o.reason === 'string' && units === 'SI') { out.reason = literalToSI(o.reason); }
            if (typeof o.name_ko === 'string' && typeof o.id === 'string' && 'verdict' in o) { delete out.name; }
            // 구간 · 지점 이름표(「정모멘트 3.25–12.50 ft」)의 수도 SI 로
            if (units === 'SI' && typeof o.label === 'string') { out.label = literalToSI(o.label); }
            if (o.fastener_label_parts && typeof o.fastener_label_parts === 'object') {
                out.fastener_label = fastenerLabel(o.fastener_label_parts, ro, o.fastener_label);
                delete out.fastener_label_parts;
            }
            return out;
        }
        return fixI621(walk(tree));
    }

    /**
     * 나무(결과 · 여러 결과) 안의 알림을 글로 찾는 함수 — 호스트가 옮겨 담은 옛 글(dsm_warnings · purlin_warnings …)을 같은 알림의 한국어로.
     * 찾지 못한 글은 그대로(SI 면 그 안의 US 상수만 바꾼다).
     */
    function textMap(tree, opts) {
        const byText = new Map();
        const gather = (o, depth) => {
            if (!o || typeof o !== 'object' || depth > 40) { return; }
            if (Array.isArray(o)) { o.forEach((x) => gather(x, depth + 1)); return; }
            if (isNotices(o.notices)) { o.notices.forEach((n) => { if (n && typeof n.text === 'string' && !byText.has(n.text)) { byText.set(n.text, n); } }); }
            for (const k of Object.keys(o)) { if ((k !== 'notices' || !isNotices(o[k])) && o[k] && typeof o[k] === 'object') { gather(o[k], depth + 1); } }
        };
        gather(tree, 0);
        const o2 = { units: opts && opts.units === 'SI' ? 'SI' : 'US', lang: opts && opts.lang === 'en' ? 'en' : 'ko' };
        return (s) => {
            if (typeof s !== 'string') { return s; }
            const n = byText.get(s);
            return n ? render(n, o2) : (o2.units === 'SI' ? literalToSI(s) : s);
        };
    }

    /** 보고서 · 화면에 넘길 검토 항목 하나 — 이유를 한국어(그 단위)로 그리고 구조 필드를 뺀다, 이름은 name_ko 를 먼저 */
    function readerCheck(c, opts) {
        if (!c || typeof c !== 'object') { return c; }
        const r = reason(c, { units: opts && opts.units === 'SI' ? 'SI' : 'US', lang: 'ko' });
        const out = { ...c };
        for (const k of REASON_KEYS) { delete out[k]; }
        if (r !== null) { out.reason = r; }
        return out;
    }

    return { render, reason, reasonNotice, lines, texts, fastenerLabel, localize, forReader, textMap, readerCheck, i621ToSI, pyFormat, reprFloat, literalToSI, QUANTITY: Q, UNCHANGED, isDimensional };
}));
