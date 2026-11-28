/* global module, globalThis, require */
// StcfsdUtils — DOM 무의존 순수 유틸 (app.js에서 분리, 0926 후속-1).
// UMD: 브라우저에서는 globalThis.StcfsdUtils, node 테스트에서는 require.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./notices'));
        return;
    }
    // K4b: 엔진 알림의 경계(webview/js/notices.js — 브라우저에서는 utils.js 보다 먼저 싣는다)
    root.StcfsdUtils = factory(root.StcfsdNotices);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (NOTICES) {
    // 숫자 포맷: 비숫자 '-', 미소값 지수, 나머지 소수 4자리
    function fmt(v) {
        if (typeof v !== 'number') { return '-'; }
        return Math.abs(v) < 0.01 ? v.toExponential(3) : v.toFixed(4);
    }

    // 로그 간격 수열 (반파장 범위 생성용)
    function logspace(a, b, n) {
        const arr = [];
        for (let i = 0; i < n; i++) {
            arr.push(Math.pow(10, a + (b - a) * i / (n - 1)));
        }
        return arr;
    }

    // 볼록껍질 (Andrew monotone chain) — 소성 곡면 P-M 도표용
    function convexHull(points) {
        if (points.length < 3) { return points.slice(); }
        const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const cross = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
        const lower = [];
        for (const p of pts) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) { lower.pop(); }
            lower.push(p);
        }
        const upper = [];
        for (let i = pts.length - 1; i >= 0; i--) {
            const p = pts[i];
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) { upper.pop(); }
            upper.push(p);
        }
        upper.pop(); lower.pop();
        return lower.concat(upper);
    }

    // ── 3상태 판정 (엔진 pass: true / false / null) ─────────────────────────
    // null 은 「판정 없음」 — 해당하는 한계상태를 평가하지 못했다는 뜻이다.
    // 화면 어디서도 OK 로 보이면 안 되고, 불합격이 하나라도 있으면 NG 가 이긴다.
    const VERDICT_VIEW = {
        PASS: { state: 'PASS', label: '✓ OK', short: 'OK', cls: 'pass', icon: '✅', color: '#4caf50' },
        FAIL: { state: 'FAIL', label: '✗ NG', short: 'NG', cls: 'fail', icon: '❌', color: '#f44336' },
        NOT_CHECKED: { state: 'NOT_CHECKED', label: '⚠ 판정 없음 (미검토)', short: '판정 없음',
            cls: 'warn', icon: '⚠', color: '#ff9800' },
    };

    function _view(state) {
        return Object.assign({}, VERDICT_VIEW[state] || VERDICT_VIEW.NOT_CHECKED);
    }

    /** 결과 객체(또는 pass 값 자체)의 판정. 오류·결과 없음·pass 없음은 판정 없음. */
    function verdictOf(result) {
        if (result === true) { return _view('PASS'); }
        if (result === false) { return _view('FAIL'); }
        if (!result || typeof result !== 'object' || result.error) { return _view('NOT_CHECKED'); }
        if (result.pass === false) { return _view('FAIL'); }
        if (result.pass === true && result.verification_complete !== false) { return _view('PASS'); }
        return _view('NOT_CHECKED');
    }

    /** 여러 판정을 하나로: 불합격 하나 → NG, 그 밖에 판정 없음 하나 → 판정 없음, 모두 OK → OK.
     *  빈 목록은 판정 없음(검토한 것이 없다). null/undefined 항목은 「평가하지 못한 검토」로 센다. */
    function combineVerdicts(items) {
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) { return _view('NOT_CHECKED'); }
        let anyUnchecked = false;
        for (const it of list) {
            const v = verdictOf(it);
            if (v.state === 'FAIL') { return _view('FAIL'); }
            if (v.state !== 'PASS') { anyUnchecked = true; }
        }
        return _view(anyUnchecked ? 'NOT_CHECKED' : 'PASS');
    }

    /**
     * 엔진 · MCP 인자 이름 → 화면 칸 이름(V4-33). 엔진 문장을 그대로 넘길 때 사용자가 찾을 칸을 화면 이름과 탭으로 적는다.
     * [인자, 화면 이름, 탭]
     */
    const USER_TERMS = [
        ['i621_conditions_confirmed', '§I6.2.1 조건 (i)–(n) 확인', '② 하중계산'],
        ['I_span_in4', '경간별 Ix', '② 하중계산'],
        ['pattern_loading', '활하중 부분재하(패턴) 검토', '② 하중계산'],
        ['lr_reduced', '지붕 활하중 감소 적용', '② 하중계산'],
        ['insulation_in', '단열재 두께 ti', '② 하중계산'],
        ['brace_points_ft', '이산 브레이스 위치', '② 하중계산'],
        ['R_tested_uplift', '스탠딩심 시험 R', '② 하중계산'],
        ['kphi_override', 'kφ override', '② 하중계산'],
        ['kx_override', 'kx override', '② 하중계산'],
        ['May_strength', 'May (약축 가용강도)', '② 하중계산'],
        ['wc_support_fastener_spacing', '웹 크리플링 sf', '③ 좌굴해석·부재설계'],
        ['wc_edge_distance', '웹 크리플링 eITF', '③ 좌굴해석·부재설계'],
        ['wc_overhang', '웹 크리플링 Lo', '③ 좌굴해석·부재설계'],
        ['wc_n_webs', '웹 크리플링 nweb', '③ 좌굴해석·부재설계'],
        ['wc_N', '웹 크리플링 N', '③ 좌굴해석·부재설계'],
        ['wc_P', '웹 크리플링 반력 P', '③ 좌굴해석·부재설계'],
        ['wc_R', '웹 크리플링 R', '③ 좌굴해석·부재설계'],
        ['dist_M1_M2', 'β M1/M2', '③ 좌굴해석·부재설계'],
        ['dist_Lm', 'β Lm', '③ 좌굴해석·부재설계'],
        ['use_inelastic_reserve', '§F2.4.2 Inelastic Reserve', '③ 좌굴해석·부재설계'],
        ['use_cold_work', '§A3.3.2 Cold Work', '① 단면·재료'],
        // 결정 T7(2026-11-26): 웹 구멍 · 횡방향 웹 보강재 · §H4 구역의 칸(엔진 이유 글이 이 이름으로 빠진 자료를 말한다)
        ['hole_shape', '웹 구멍 모양', '③ 좌굴해석·부재설계'],
        ['hole_depth', '웹 구멍 dh', '③ 좌굴해석·부재설계'],
        ['hole_length', '웹 구멍 Lh', '③ 좌굴해석·부재설계'],
        ['hole_spacing', '웹 구멍 중심 간격 s', '③ 좌굴해석·부재설계'],
        ['hole_end_distance', '웹 구멍 단부 거리', '③ 좌굴해석·부재설계'],
        ['hole_web_offset', '웹 구멍 치우침', '③ 좌굴해석·부재설계'],
        ['hole_corner_radius', '웹 구멍 모서리 r', '③ 좌굴해석·부재설계'],
        ['hole_bearing_distance', '웹 구멍 지압까지 x', '③ 좌굴해석·부재설계'],
        ['hole_edge_stiffened', '웹 구멍 가장자리 보강', '③ 좌굴해석·부재설계'],
        ['hole_within_bearing', '웹 구멍이 지압 길이 안', '③ 좌굴해석·부재설계'],
        ['transverse_stiffeners', '횡방향 웹 보강재', '③ 좌굴해석·부재설계'],
        ['stiffener_spacing', '보강재 간격 a', '③ 좌굴해석·부재설계'],
        ['stiffener_kind', '보강재 종류', '③ 좌굴해석·부재설계'],
        ['stiffener_Is', '보강재 Is', '③ 좌굴해석·부재설계'],
        ['stiffener_area', '보강재 단면적', '③ 좌굴해석·부재설계'],
        ['stiffener_Fy', '보강재 Fy', '③ 좌굴해석·부재설계'],
        ['torsion_f_bending_max', '비틀림 최대 휨 응력', '③ 좌굴해석·부재설계'],
        ['torsion_f_bending', '비틀림 휨 응력 fb', '③ 좌굴해석·부재설계'],
        ['torsion_f_torsion', '비틀림 뒤틀림 fw', '③ 좌굴해석·부재설계'],
        ['torsion_eccentricity', '비틀림 편심 e', '③ 좌굴해석·부재설계'],
        ['torsion_span', '비틀림 경간 L', '③ 좌굴해석·부재설계'],
        ['torsion_load', '비틀림 하중', '③ 좌굴해석·부재설계'],
        ['torsion_support', '비틀림 지지', '③ 좌굴해석·부재설계'],
        ['torsion_at_web_flange_junction', '비틀림 웹–플랜지 이음', '③ 좌굴해석·부재설계'],
        ['confirm_large', '「그래도 실행」 단추', null],
    ];
    const _TERM_RE = new RegExp('\\b(' + USER_TERMS.map(t => t[0]).join('|') + ')(\\s*=\\s*(True|False|true|false))?\\b', 'g');
    function userText(s) {
        if (typeof s !== 'string' || !s) { return s; }
        return s.replace(_TERM_RE, (m, name, eq, val) => {
            const t = USER_TERMS.find(x => x[0] === name);
            if (!t) { return m; }
            const lab = name === 'confirm_large' ? t[1] : '「' + t[1] + '」' + (t[2] ? '(' + t[2] + ' 탭)' : '');
            if (!eq) { return lab; }
            return lab + (/^t/i.test(val) ? ' 켬' : ' 끔');
        });
    }

    /**
     * 2026-11-26(엔진 8f9126e — 독립 검증 5): 구멍 · 보강재 · 비틀림 입력의 잘못된 값에 엔진이 내는 오류
     * ('holes: …' · 'stiffeners: …' · 'torsion: …' — 그 입력의 이름으로 시작) → 사람이 읽는 글: 어느 구역 · 어느 칸 · 무엇이 틀렸는지.
     * 그런 오류가 아니면 null(부르는 쪽이 지금처럼 그린다). 수는 엔진의 단위(US) 그대로 — 그렇다고 적는다.
     */
    const _INPUT_ERR_GROUPS = { holes: '웹 구멍(천공)', stiffeners: '횡방향 웹 보강재', torsion: '비틀림(§H4)' };
    function inputErrorText(err) {
        const m = /^(holes|stiffeners|torsion):\s*([\s\S]*)$/.exec(String(err || ''));
        if (!m) { return null; }
        let s = m[2]
            .replace(/\bmust be > 0\b/g, '— 0 보다 큰 수여야 합니다')
            .replace(/\bmust be >= 0\b/g, '— 0 이상이어야 합니다')
            .replace(/\bmust be a number\b/g, '— 수여야 합니다')
            .replace(/\bmust be finite\b/g, '— 유한한 수여야 합니다')
            .replace(/\bmust be true or false\b/g, '— 켬 · 끔이어야 합니다')
            .replace(/\bmust be text\b/g, '— 글이어야 합니다')
            .replace(/\bis required\b/g, '— 비어 있습니다(필요)')
            .replace(/,\s*got\s+(.+)$/, ' (받은 값 $1 — 엔진 단위 US)');
        return '입력 오류 — 「' + _INPUT_ERR_GROUPS[m[1]] + '」 구역: ' + userText(s);
    }

    function _itemText(item) {
        if (item == null) { return ''; }
        if (typeof item === 'string') { return userText(item); }
        if (typeof item === 'object') {
            const name = item.name || item.check || item.limit_state || item.id || '';
            const reason = item.reason || item.message || item.note || '';
            return userText([name, reason].filter(Boolean).join(' — ')) || JSON.stringify(item);
        }
        return userText(String(item));
    }

    /**
     * K4b: 결과의 알림(notices)이 있으면 그것을 한국어로, opts.units(US · SI)로 그린 글 — 옛 글과 하나씩 맞는 것만, 나머지(호스트가 더한 글)는
     * 그 글 그대로. 알림이 없는 결과는 null(옛 글을 쓴다).
     */
    function _noticeTexts(result, key, opts) {
        if (!NOTICES || !result || typeof result !== 'object' || !Array.isArray(result.notices) || !result.notices.some((n) => n && typeof n === 'object')) { return null; }
        if (!['warnings', 'assumptions', 'scope_notes', 'not_evaluated'].includes(key)) { return null; }
        const units = opts && opts.units === 'SI' ? 'SI' : 'US';
        return NOTICES.lines(result, { units, lang: 'ko', lists: [key] }).map((l) => {
            // 입력 이름(wc_P …)은 화면의 칸 이름으로 — 알림이든 옛 글이든
            const t = userText(l.text);
            return l.subject ? l.subject + ' — ' + t : t;
        });
    }
    /** 검토 항목의 이유(한국어, opts.units) — 구조가 없으면 옛 글 */
    function checkReason(check, opts) {
        if (!check || typeof check !== 'object') { return null; }
        if (NOTICES) { const r = NOTICES.reason(check, { units: opts && opts.units === 'SI' ? 'SI' : 'US', lang: 'ko' }); if (r !== null) { return r; } }
        return typeof check.reason === 'string' ? check.reason : null;
    }

    /** 엔진의 「평가하지 못한 것」 목록(키 이름이 모듈마다 다르다)을 사람이 읽는 문장 목록으로. */
    function notEvaluatedList(result, opts) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const push = (item) => {
            const s = _itemText(item);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        };
        const viaNotices = _noticeTexts(result, 'not_evaluated', opts);
        // 접합부는 not_evaluated_relevant 가 판정을 막는 것(not_evaluated 는 정보 포함 전체)이다.
        const keys = ['not_evaluated_relevant', 'not_evaluated', 'checks_not_evaluated'];
        for (const k of keys) {
            if (k === 'not_evaluated' && viaNotices) {
                // not_evaluated_relevant(옛 글)에 이미 실린 항목은 다시 싣지 않는다 — 같은 자리의 옛 글로 맞댄다
                const relevant = new Set((Array.isArray(result.not_evaluated_relevant) ? result.not_evaluated_relevant : []).map((x) => JSON.stringify(x)));
                const olds = Array.isArray(result.not_evaluated) ? result.not_evaluated : [];
                viaNotices.forEach((t, i) => { if (!relevant.has(JSON.stringify(olds[i])) && t && !seen.has(t)) { seen.add(t); out.push(t); } });
                continue;
            }
            const v = result[k];
            if (Array.isArray(v)) { v.forEach(push); }
            else if (typeof v === 'string' && v) { push(v); }
        }
        return out;
    }

    /** 엔진 경고 목록(문자열 배열) — 중복 제거. */
    function warningsList(result, opts) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const add = (w) => {
            const s = _itemText(w);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        };
        const viaNotices = _noticeTexts(result, 'warnings', opts);
        if (viaNotices) { viaNotices.forEach((t) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }); }
        else if (Array.isArray(result.warnings)) { result.warnings.forEach(add); }
        if (typeof result.warning === 'string' && result.warning) { add(result.warning); }
        if (typeof result.dsm_warning === 'string' && result.dsm_warning) { add(result.dsm_warning); }
        return out;
    }

    function _listOf(result, key, opts) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const viaNotices = _noticeTexts(result, key, opts);
        if (viaNotices) { viaNotices.forEach((t) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } }); return out; }
        const v = result[key];
        const items = Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);
        items.forEach((it) => {
            const s = _itemText(it);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        });
        return out;
    }

    /** 엔진 가정 목록(FIXES §3.1.1 — 기본값 입력·해석식 대체·보수 대체·자체 해석). */
    function assumptionsList(result, opts) { return _listOf(result, 'assumptions', opts); }

    /** 범위 안내(언제나 참인 적용 범위 문장) — 접어서 보인다. */
    function scopeNotesList(result, opts) { return _listOf(result, 'scope_notes', opts); }

    /**
     * 퍼린 묶음의 목록(purlinPacket 의 purlin_*) → 사람이 읽는 글(한국어, opts.units). 묶음의 알림(purlin_notices)으로 그리고,
     * 알림이 없는 옛 글은 그대로. { warn, ne, asm, loadNe }
     */
    function purlinLists(d, opts) {
        const ns = d && Array.isArray(d.purlin_notices) ? d.purlin_notices : [];
        const of = (key, list, as) => {
            const arr = d && Array.isArray(d[key]) ? d[key] : [];
            if (!NOTICES || !ns.length) { return arr.filter((x) => typeof x === 'string'); }
            const r = { [as]: arr, notices: ns.filter((n) => n && n.list === list).map((n) => (list === as ? n : Object.assign({}, n, { list: as }))) };
            return _noticeTexts(r, as, opts) || arr;
        };
        return { warn: of('purlin_warnings', 'warnings', 'warnings'), ne: of('purlin_not_evaluated', 'not_evaluated', 'not_evaluated'),
            asm: of('purlin_assumptions', 'assumptions', 'assumptions'), loadNe: of('purlin_load_not_evaluated', 'load_not_evaluated', 'not_evaluated') };
    }

    /** 이용률(비) 표시값. 판정이 OK 가 아니면 「OK」 문구를 붙이지 않는다. */
    function ratioWithVerdict(ratio, result) {
        const v = verdictOf(result);
        const pct = (typeof ratio === 'number' && isFinite(ratio)) ? (ratio * 100).toFixed(1) + '%' : '—';
        return pct + ' ' + v.short;
    }

    /**
     * 퍼린 설계 결과에서 지배 구간 하나를 고른다(화면의 설계 카드와 Lap 본문의 Se · Mnd · Vn 이 쓴다).
     * K2(결정 6): 화면(app.js)에 있던 것을 그대로 옮겨 화면과 호스트가 같이 쓴다 — 바이트까지 같은 결과(고정값 gui-purlin).
     * labelFn: 구간 라벨을 화면 단위로 바꾸는 함수(화면은 SI 면 ft → m, 호스트는 그대로 — 라벨은 Lap 본문에 쓰이지 않는다).
     * 나중에(K2 밖): 엔진의 design_checks[].governs(docs/implementation/20261123-check-contract.md)와 이 고르기를 여기서 대조한다 —
     * 지금은 바꾸지 않는다(불합격 구간이 있으면 그 중 이용률 최대, 없으면 이용률 최대).
     */
    function pickGoverningPurlinDesign(data, labelFn) {
        if (!data) return null;
        const lbl = typeof labelFn === 'function' ? labelFn : (x) => String(x || '');
        // 새 형식: host 가 구간(region)마다 aisi_design 한 결과 목록과 3상태 종합 판정(pass)을 준다.
        // 옛 형식(저장된 .csd): design_positive/negative/lap/uplift 네 키만 있다.
        let candidates;
        if (Array.isArray(data.regions) && data.regions.length > 0) {
            candidates = data.regions
                .filter(rg => rg && rg.result && !rg.result.error)
                .map(rg => ({ label: lbl(rg.label || rg.kind || '구간'), kind: rg.kind || '', result: rg.result, region: rg }));
        } else {
            candidates = [
                ['정모멘트', 'positive', data.design_positive],
                ['부모멘트', 'negative', data.design_negative],
                ['랩 구간', 'lap', data.design_lap],
                ['양력', 'uplift', data.design_uplift],
            ].filter(([, , d]) => d && !d.error)
                .map(([label, kind, d]) => ({ label: String(label), kind: String(kind), result: d, region: d.region || null }));
        }
        if (candidates.length === 0) return data;
        const util = (c) => (typeof c.result.utilization === 'number' && isFinite(c.result.utilization)) ? c.result.utilization : -1;
        const failing = candidates.filter(c => verdictOf(c.result).state === 'FAIL');
        const pool = failing.length > 0 ? failing : candidates;
        pool.sort((a, b) => util(b) - util(a));
        const gov = pool[0];
        const design = gov.result;
        const combinedPass = ('pass' in data)
            ? data.pass
            : (() => {
                const v = combineVerdicts(candidates.map(c => c.result)).state;
                return v === 'PASS' ? true : (v === 'FAIL' ? false : null);
            })();
        return {
            ...design,
            member_type: 'flexure',
            // 지배 구간 이름표 + 그 구간의 모드(엔진 이름표의 한국어). 모드의 옆 필드 · id 는 빼서 forPage 가 이름표를 지우지 않게
            controlling_mode: `${gov.label}: ${design.controlling_mode_ko || design.controlling_mode || ''}`.trim(),
            controlling_mode_code: design.controlling_mode_code, controlling_mode_kind: undefined, controlling_mode_ko: undefined,
            controlling_mode_template: undefined, controlling_mode_template_ko: undefined, controlling_mode_params: undefined, controlling_mode_id: undefined,
            purlin_mode: true,
            pass: combinedPass,
            verification_complete: combinedPass === true ? design.verification_complete : false,
            utilization: (typeof data.utilization === 'number' && isFinite(data.utilization))
                ? data.utilization : design.utilization,
            purlin_governing: data.governing || { kind: gov.kind, label: gov.label },
            purlin_regions: Array.isArray(data.regions) ? data.regions : null,
            purlin_not_evaluated: Array.isArray(data.not_evaluated) ? data.not_evaluated : [],
            purlin_warnings: Array.isArray(data.warnings) ? data.warnings : [],
            purlin_assumptions: Array.isArray(data.assumptions) ? data.assumptions : [],
            purlin_load_not_evaluated: Array.isArray(data.load_not_evaluated) ? data.load_not_evaluated : [],
            // 묶음의 목록마다 알림(호스트 host.* · 엔진 · 「[하중] …」) — purlinLists 가 그 단위의 한국어로 그린다
            purlin_notices: Array.isArray(data.notices) ? data.notices : [],
            design_positive: data.design_positive || null,
            design_negative: data.design_negative || null,
            design_lap: data.design_lap || null,
            design_uplift: data.design_uplift || null,
            uplift_R: data.uplift_R,
            deck: data.deck || null,
            span_type: data.span_type || '',
            // 2026-11-28 결정 S1: 경간마다 단면이면 단면마다의 블록 · 경간 → 단면(없으면 키가 없다 — 지금까지의 꼴)
            ...(Array.isArray(data.sections) ? { purlin_sections: data.sections, purlin_span_sections: Array.isArray(data.span_sections) ? data.span_sections : null } : {}),
        };
    }

    /**
     * 2026-11-28 결정 S1: 경간마다 단면인 퍼린 결과에서 랩 지점을 정하지 않았을 때의 지배 랩(불합격 → 큰 이용률, 판정 없음은 뒤) — 1 부터의 지점 번호.
     * 경간마다 단면이 아닌 결과 · 랩 구간이 없으면 null(지금까지처럼 지점을 정해야 한다).
     */
    function governingLapSupport(purlin) {
        const c = governingLapChoice(purlin);
        return c ? c.support : null;
    }
    /**
     * 검증 2026-11-28 의 9: 지배 랩을 고른 근거 — 고르는 규칙은 governingLapSupport 그대로(중력 랩 구간 가운데 불합격 → 큰 이용률, 평가하지 못한 랩은 뒤).
     * 평가하지 못한 랩(판정 null)과 고르는 데 넣지 않은 양력 랩을 함께 — 알림이 「평가한 중력 랩 가운데」 라고 말하고 그 랩들을 든다.
     * @returns {{support: number, chosen: any, evaluated: boolean, not_evaluated: any[], uplift_laps: any[]}|null}
     */
    function governingLapChoice(purlin) {
        if (!purlin || !Array.isArray(purlin.regions) || !Array.isArray(purlin.span_sections)) { return null; }
        const laps = purlin.regions.filter((g) => g && g.kind === 'lap' && Number.isInteger(Number(g.support)) && g.result);
        if (!laps.length) { return null; }
        const u = (g) => (typeof g.result.utilization === 'number' && isFinite(g.result.utilization) ? g.result.utilization : -1);
        const fail = laps.filter((g) => g.result.pass === false);
        const pool = (fail.length ? fail : laps).slice().sort((a, b) => u(b) - u(a));
        const chosen = pool[0];
        const uplift = purlin.regions.filter((g) => g && g.kind !== 'lap' && (g.lap === true || /^uplift_(lap|support_lap)-/.test(String(g.id))));
        return { support: Number(chosen.support) + 1, chosen, evaluated: chosen.result.pass === true || chosen.result.pass === false,
            not_evaluated: laps.filter((g) => g.result.pass !== true && g.result.pass !== false), uplift_laps: uplift };
    }

    /**
     * 2026-11-28 결정 S1 · S5: 랩 접합 도구의 두 부재 — 경간마다 단면인 퍼린 결과의 그 지점 랩 구간(lap_members)에서. 화면 본문(app.js 랩 단추)과
     * 호스트 본문(src/case/requests.ts buildLapRequest)이 이 한 함수를 쓴다. 경간마다 단면이 아니면 null(지금까지의 본문 그대로).
     * 부재 1 = 왼쪽 경간의 부재, 부재 2 = 오른쪽. 부재마다 d · t(그 단면의 템플릿 치수 — hat 은 B 가 깊이), Se · Vn(그 부재 결과의 lap_section —
     * 랩 구속을 밝혔을 때만), Sf(그 단면의 Sx), Ixx(하중 해석이 몫에 쓴 Ix). allS1 = 두 부재가 모두 모델(S1) — 그때 본문은 지금까지와 같다.
     * @returns {{support: number, defaulted: boolean, allS1: boolean, same: boolean, depth_mismatch: boolean, members: any[], regions: string[]}|null}
     */
    function lapTwoMembers(purlin, support, opts) {
        if (!purlin || !Array.isArray(purlin.regions) || !Array.isArray(purlin.span_sections) || !Array.isArray(purlin.sections)) { return null; }
        let sup = Number.isInteger(support) && support >= 1 ? support : null;
        let defaulted = false;
        if (sup === null) { sup = governingLapSupport(purlin); defaulted = sup !== null; }
        if (sup === null) { return null; }
        const regs = purlin.regions.filter((g) => g && g.kind === 'lap' && Number(g.support) === sup - 1);
        const withMembers = regs.filter((g) => Array.isArray(g.lap_members) && g.lap_members.length === 2);
        if (!withMembers.length) { return null; }
        const stated = !!(opts && opts.stated);
        const secOf = (id) => purlin.sections.find((x) => x && x.id === id) || null;
        const members = [0, 1].map((i) => {
            const m0 = withMembers[0].lap_members[i];
            const sec = secOf(m0.section_id);
            const p = (sec && sec.params) || {};
            const hat = sec && sec.template === 'hat';
            const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
            // Se · Vn: 그 지점의 랩 구간(왼쪽 · 오른쪽)마다의 그 부재 — 작은 쪽(지금까지의 규칙과 같다). 진술이 없으면 짓지 않는다
            let Se = null, Vn = null;
            if (stated) {
                for (const g of withMembers) {
                    const ls = g.lap_members[i] && g.lap_members[i].lap_section;
                    if (!ls || ls.available === false) { Se = null; Vn = null; break; }
                    const se = ls.Se && Number(ls.Se.value), vn = ls.Vn && Number(ls.Vn.value);
                    if (se > 0 && (Se === null || se < Se)) { Se = se; }
                    if (vn > 0 && (Vn === null || vn < Vn)) { Vn = vn; }
                }
            }
            return { section_id: m0.section_id, span: m0.span, d: num(hat ? p.B : p.H), t: num(p.t), Se, Vn,
                Sf: sec && sec.props && num(sec.props.Sf !== undefined ? sec.props.Sf : sec.props.Sx), Ixx: num(m0.Ixx) };
        });
        const allS1 = members.every((m) => m.section_id === 'S1');
        const same = members[0].section_id === members[1].section_id;
        const dm = members[0].d !== null && members[1].d !== null && Math.abs(members[0].d - members[1].d) > 1e-6 * Math.max(members[0].d, members[1].d);
        return { support: sup, defaulted, allS1, same, depth_mismatch: dm, members, regions: withMembers.map((g) => String(g.id)) };
    }

    /**
     * 검증 2026-11-28 의 3: 경간마다 단면의 퍼린 결과가 없을 때(또는 그 결과에 그 지점의 랩이 없을 때) 랩 접합의 두 부재를 검토 상태의 단면 목록에서 —
     * 화면 본문(app.js 랩 단추)과 호스트 본문(requests.ts lapSectionFor)이 이 한 함수를 쓴다. 모든 경간이 S1 이면 null(지금까지의 본문 그대로).
     * 모든 경간이 같은 단면 X 면 지점과 상관없이 X | X. 아니면 지점(1 부터)이 있어야 한다 — 부재 1 = 그 지점 왼쪽 경간, 부재 2 = 오른쪽(끝 지점은 그 경간 둘).
     * 지점이 없으면 { error } — 모두 S1 인 것처럼 설계하지 않는다. 부재마다 d · t 만(그 단면의 템플릿 치수 — hat 은 B 가 깊이, S1 은 s1 의 치수):
     * Se · Vn · Sf · Ix 는 퍼린 실행만이 주므로 없다(그 값을 쓰는 검토는 엔진이 「평가하지 못함」 으로).
     * @param {string[]} spanSections  경간마다 단면 id
     * @param {any[]} sections  단면 목록 S2 … [{id, template, params}] (US)
     * @param {{template?: string, H?: number, B?: number, t?: number}} s1  S1(모델)의 템플릿 · 치수(US)
     * @param {number|null} support  랩 지점(1 부터) — 없으면 null
     */
    function lapMembersFromSections(spanSections, sections, s1, support) {
        const ids = Array.isArray(spanSections) ? spanSections : [];
        if (!ids.some((x) => x !== 'S1')) { return null; }
        const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
        const list = Array.isArray(sections) ? sections : [];
        const distinct = Array.from(new Set(ids));
        let left, right, sup = Number.isInteger(support) && support >= 1 ? support : null;
        if (distinct.length === 1) {
            left = { id: distinct[0], span: sup !== null && sup >= 2 && sup - 2 < ids.length ? sup - 2 : 0 };
            right = { id: distinct[0], span: sup !== null && sup - 1 < ids.length ? sup - 1 : 0 };
        } else {
            if (sup === null) {
                return { error: '경간마다 단면이 달라(' + ids.map((id, i) => (i + 1) + ': ' + id).join(', ') + ') 어느 두 부재를 잇는 랩인지 알 수 없습니다 — 랩 지점(connLapSupport)을 정하거나 퍼린 검토를 먼저 실행하십시오(모두 S1 인 것처럼 설계하지 않습니다).' };
            }
            const li = sup - 2, ri = sup - 1;
            const has = (i) => i >= 0 && i < ids.length;
            if (!has(li) && !has(ri)) { return { error: '랩 지점 ' + sup + ' 이(가) 경간 표에 없습니다(지점 1 – ' + (ids.length + 1) + ').' }; }
            left = { id: has(li) ? ids[li] : ids[ri], span: has(li) ? li : ri };
            right = { id: has(ri) ? ids[ri] : ids[li], span: has(ri) ? ri : li };
        }
        const s = s1 || {};
        const member = (m) => {
            if (m.id === 'S1') {
                const hat = s.template === 'hat';
                return { section_id: 'S1', span: m.span, d: num(hat ? s.B : s.H), t: num(s.t), Se: null, Vn: null, Sf: null, Ixx: null };
            }
            const sec = list.find((x) => x && x.id === m.id);
            if (!sec) { return null; }
            const p = sec.params || {};
            const hat = sec.template === 'hat';
            return { section_id: m.id, span: m.span, d: num(hat ? p.B : p.H), t: num(p.t), Se: null, Vn: null, Sf: null, Ixx: null };
        };
        const a = member(left), b = member(right);
        if (!a || !b) { return { error: '경간의 단면 ' + (!a ? left.id : right.id) + ' 이(가) 단면 목록에 없습니다.' }; }
        const members = [a, b];
        const dm = a.d !== null && b.d !== null && Math.abs(a.d - b.d) > 1e-6 * Math.max(a.d, b.d);
        return { support: sup, defaulted: false, from_list: true, allS1: a.section_id === 'S1' && b.section_id === 'S1', same: a.section_id === b.section_id,
            depth_mismatch: dm, members, regions: [] };
    }

    /**
     * 결정 S1 · S5: 랩 본문에 두 부재를 얹는다(lapTwoMembers 의 답 — null 이거나 두 부재가 모두 S1 이면 본문을 바꾸지 않는다).
     * 부재 1 의 d · t · Se · Sf · Vn 을 그 단면의 것으로, 두 단면이 다르면 부재 2 의 키(t_2 · d_2 · Se_2 · Sf_2 · Vn_2)와 Ixx · Ixx_2(엔진 lap_connection —
     * 패스너는 두 방향 가운데 작은 것, 팔은 작은 쪽, 휨은 강성비의 몫, 춤이 다르면 평가하지 않음). 없는 값은 넣지 않는다(엔진이 「평가하지 못함」 으로).
     */
    function applyLapTwoMembers(data, two) {
        if (!data || !two || two.allS1) { return data; }
        const a = two.members[0], b = two.members[1];
        const put = (k, v) => { if (typeof v === 'number' && isFinite(v)) { data[k] = v; } else { delete data[k]; } };
        if (a.d !== null) { data.d = a.d; }
        if (a.t !== null) { data.t = a.t; }
        put('Se', a.Se);
        put('Sf', a.Se !== null ? a.Sf : null);
        put('Vn', a.Vn);
        if (!two.same) {
            put('t_2', b.t); put('d_2', b.d); put('Se_2', b.Se); put('Sf_2', b.Se !== null ? b.Sf : null); put('Vn_2', b.Vn);
            put('Ixx', a.Ixx); put('Ixx_2', b.Ixx);
        }
        return data;
    }

    /**
     * V8-01 — 랩 검토(Lap 접합)의 단면 강도를 퍼린 결과에서: **그 랩이 걸친 지점의 랩 구간**(kind 'lap', 그 지점) 결과에서만.
     * 지배 구간(pickGoverningPurlinDesign)에서 가져오지 않는다 — 다른 구간의 횡비틀림 · 뒤틀림 감소를 품는다.
     *  - 부재마다 Se = Mnℓ / Fy(그 구간의 결과 — 검토 항목 member.flexure.local 의 반올림 전 nominal — 랩 구속의 진술이 있으면 랩 안은 Fn = Fy, Mne = My 로 낸 Mnℓ). 그 지점의 랩 구간이
     *    둘(왼쪽 · 오른쪽)이면 작은 쪽.
     *  - Vn = 그 구간의 전단 검토의 Vn. Mnd 는 보내지 않는다(랩 도구가 진술로 뒤틀림을 다룬다 — 엔진).
     *  - 그 구간이 비탄성 여유(Mne > My) · 냉간 가공(Fy_used > Fy)으로 낸 것이면 짓지 않는다(엔진 계약 — 그것 없는 Mnℓ 이 결과에 없다).
 *  - 지점을 모르거나(support 없음), 그 지점의 랩 구간 결과가 없거나, 랩 구속을 밝히지 않았으면 **아무것도 짓지 않는다**
     *    (Se · Vn null, reason — 엔진은 휨 검토를 「판정 없음」 으로 밝힌다).
     * @param {any} purlin  퍼린 결과 묶음(regions[] — design_purlin 의 답 그대로)
     * @param {number|null|undefined} support  랩이 걸친 지점 번호(1 부터 — 화면의 「지점 3」)
     * @param {{stated?: boolean}} [opts]  랩 구속의 진술(lap_restrained)
     * @returns {{Se: number|null, Vn: number|null, from: string|null, regions: string[], support: number|null, reason: string|null}}
     */
    function deriveLapSection(purlin, support, opts) {
        // 까닭 · 출처는 호스트 알림(host.lap.* — notices.js HOST): reason / from 은 그 영어 글, *_notice 가 알림(한국어 · 단위는 그리는 쪽이)
        const none = (code, values) => {
            const n = NOTICES ? NOTICES.hostNotice(code, values || {}) : null;
            return { Se: null, Vn: null, from: null, regions: [], support: Number.isInteger(support) ? support : null, reason: n ? n.text : code, reason_notice: n };
        };
        if (!purlin || !Array.isArray(purlin.regions)) { return none('host.lap.no_purlin'); }
        if (!Number.isInteger(support) || support < 1) { return none('host.lap.no_support'); }
        if (!(opts && opts.stated)) { return none('host.lap.not_stated'); }
        const regs = purlin.regions.filter((g) => g && g.kind === 'lap' && Number(g.support) === support - 1 && g.result && !g.result.error);
        if (regs.length === 0) { return none('host.lap.no_region', { support }); }
        let Se = null, Vn = null;
        const ids = [];
        for (const g of regs) {
            // K4b(엔진 e38af69, 계약 §6.3): 랩 단면 강도는 그 구간 결과의 lap_section 블록에서 — Fn = Fy(Mne = My), §F3.2.1 국부좌굴만,
            // 비탄성 여유 · 냉간가공 없음, Se = Mnℓ / Fy, Vn = §G2.1 한 부재. 구간 자신의 검토 항목 · Mnl(여유 · 냉간가공을 품을 수 있다)은 쓰지 않는다.
            const ls = g.result.lap_section;
            if (!ls || typeof ls !== 'object') { return none('host.lap.no_block', { region: String(g.id) }); }
            if (ls.available === false || !ls.Se || !(Number(ls.Se.value) > 0)) {
                // 엔진의 까닭(lap_section.reason — 알림이면 그것)
                const why = NOTICES && NOTICES.siblingNotice(ls, 'reason') ? NOTICES.siblingNotice(ls, 'reason')
                    : { code: null, kind: 'reason', text: typeof ls.reason === 'string' ? ls.reason : (ls.reason ? JSON.stringify(ls.reason) : 'no Mnl'), text_ko: typeof ls.reason === 'string' ? ls.reason : '' };
                return none('host.lap.unavailable', { region: String(g.id), why });
            }
            const se = Number(ls.Se.value);
            if (Se === null || se < Se) { Se = se; }
            const vn = ls.Vn && Number(ls.Vn.value);
            if (vn > 0 && (Vn === null || vn < Vn)) { Vn = vn; }
            ids.push(String(g.id));
        }
        const fromN = NOTICES ? NOTICES.hostNotice('host.lap.from_regions', { regions: ids.join(', '), support }) : null;
        return { Se, Vn, from: fromN ? fromN.text : 'lap_section', from_notice: fromN, regions: ids, support, reason: null };
    }

    /**
     * B2(2026-11-25): 엔진이 표시용으로 반올림한 값(display_rounding)을 그 반올림 전 값(display_unrounded — design_checks 와 같은 수)으로
     * 바꾼 사본 — src/mcp/siUnits.ts 의 withUnroundedValues 와 같은 규칙(MCP 의 SI 응답 · 새 화면의 units.ts 가 쓰는 것). SI 로 바꾸기
     * 전에만 쓴다(반올림한 US 값을 바꾸면 design_checks 와 0.03 % 어긋난다). 하위 묶음(shear · positive_region · 조합의 compression …)은
     * display_unrounded 안의 같은 이름 묶음으로, 배열의 원소(퍼린 regions[].result)는 제 display_unrounded 로. 표시 값으로 만든
     * 요약(__display_rounded)은 그대로. 반환 { value, used }.
     */
    function withUnroundedValues(value) {
        let used = false;
        const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
        const overlay = (o, raw) => {
            const out = Object.assign({}, o);
            for (const k of Object.keys(raw)) {
                const r = raw[k];
                if (typeof r === 'number' && isFinite(r) && typeof o[k] === 'number') { out[k] = r; used = true; }
                else if (isObj(r) && isObj(o[k])) { out[k] = overlay(o[k], r); }
            }
            return out;
        };
        const walkU = (v) => {
            if (Array.isArray(v)) { return v.map(walkU); }
            if (!v || typeof v !== 'object') { return v; }
            const out = {};
            for (const k of Object.keys(v)) { out[k] = k === 'display_unrounded' ? v[k] : walkU(v[k]); }
            const raw = v.display_unrounded;
            return isObj(raw) ? overlay(out, raw) : out;
        };
        if (value && typeof value === 'object' && value.__display_rounded) { return { value, used: false }; }
        return { value: walkU(value), used };
    }

    /**
     * 엔진(2026-11-25 둘째 판): 빈 길이의 결과가 길이와 상관없는 하한(length_independent_bound — 가장 유리한 길이의 엔진 강도)으로 NG 이면
     * 그 판정비는 그 하한의 비다 — 맨 위 utilization 은 가정한 길이의 수(utilization_valid false)라 판정비가 아니다. 그런 결과가 아니면 null.
     * 반환 { ratio, governing_check, limit_state }
     */
    //
    // 2026-11-26(엔진 8f9126e — 독립 검증 2): 같은 규칙에 「구멍 없는 강도로도 넘음」 — 구멍 조항을 평가하지 못했지만 구멍은 강도를 낮추기만
    // 하므로 구멍 없는 강도의 상한(holes_strength_bound · shear.bound_without_holes · web_crippling.bound_without_holes ·
    // interaction_holes_bound)을 소요가 넘으면 불합격이다. 그 검토는 trusted false · 까닭 member.reason.fails_without_holes 인 fail —
    // 판정비는 그 상한의 비, 지배는 그 검토. 하한이 둘 이상이면 비가 가장 큰 것. 반환에 basis 'length' | 'holes' · source(엔진 키).
    // src/records/runs.ts lengthBoundFailure 와 같은 규칙(시험 web_options_contract 가 맞댄다).
    const FAILS_WITHOUT_HOLES = 'member.reason.fails_without_holes';
    /** 구멍 없는 강도의 상한으로 낸 확실한 불합격 검토(trusted false 이지만 판정이다) */
    function failsWithoutHoles(c) { return !!c && typeof c === 'object' && c.verdict === 'fail' && c.reason_code === FAILS_WITHOUT_HOLES; }
    /** 확실한 불합격의 까닭(화면 · 검증 · 보고서가 같은 글) */
    function boundFailureText(b) {
        if (!b) { return ''; }
        return b.basis === 'holes' ? '구멍 없는 강도로도 넘음 — 구멍 조항은 평가하지 못했지만 구멍은 강도를 낮추기만 하므로 불합격'
            : '길이와 상관없는 하한으로도 넘음 — 길이를 주지 않았지만 어느 길이에서도 불합격';
    }
    function holesBoundCandidates(d) {
        const out = [];
        const dc = Array.isArray(d.design_checks) ? d.design_checks : [];
        const fin = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
        const add = (id, blockRatio, limitState, source) => {
            const c = dc.find((x) => x && x.id === id) || null;
            const r = c && failsWithoutHoles(c) && fin(c.ratio) !== null ? c.ratio : fin(blockRatio);
            if (r !== null && r > 1) { out.push({ ratio: r, governing_check: c ? id : null, limit_state: limitState, basis: 'holes', source }); }
        };
        const hb = d.holes_strength_bound;
        if (hb && typeof hb === 'object') {
            const fam = hb.Pn !== undefined ? 'E axial compression' : 'F flexure';
            const ids = Object.keys(hb.checks && typeof hb.checks === 'object' ? hb.checks : {}).filter((k) => k !== 'member.flexure.positive_region');
            // 지배: 상한의 검토 가운데 비가 가장 큰 것(구멍 없는 상한의 국부 — 엔진의 Pn · Mn = min(그 셋))
            const fails = dc.filter((c) => failsWithoutHoles(c) && ids.includes(c.id) && fin(c.ratio) !== null).sort((a, b) => b.ratio - a.ratio);
            if (fails.length) { add(fails[0].id, hb.ratio, fam + ' (strength without holes)', 'holes_strength_bound'); }
            else if (fin(hb.ratio) !== null && hb.ratio > 1) { out.push({ ratio: hb.ratio, governing_check: null, limit_state: fam + ' (strength without holes)', basis: 'holes', source: 'holes_strength_bound' }); }
            if (fin(hb.ratio_positive) !== null) { add('member.flexure.positive_region', hb.ratio_positive, 'F positive region (strength without holes)', 'holes_strength_bound'); }
        }
        const sb = d.shear && typeof d.shear === 'object' ? d.shear.bound_without_holes : null;
        if (sb && typeof sb === 'object') {
            if (sb.fails === true) { add('member.shear', sb.ratio, 'G2 shear (strength without holes)', 'shear.bound_without_holes'); }
            if (sb.h2_fails === true) { add('member.bending_shear', sb.h2_total, 'H2 bending + shear (strength without holes)', 'shear.bound_without_holes'); }
        }
        const wb = d.web_crippling && typeof d.web_crippling === 'object' ? d.web_crippling.bound_without_holes : null;
        if (wb && typeof wb === 'object') {
            if (wb.fails === true) { add('member.web_crippling', wb.ratio, 'G5 web crippling (strength without holes)', 'web_crippling.bound_without_holes'); }
            if (wb.h3_fails === true) { add('member.bending_web_crippling', wb.h3_ratio, 'H3 bending + web crippling (strength without holes)', 'web_crippling.bound_without_holes'); }
        }
        const ih = d.interaction_holes_bound;
        if (ih && typeof ih === 'object') {
            add('member.axial_bending', fin(ih.total_unrounded) !== null ? ih.total_unrounded : ih.total, 'H1.2 axial + bending (strength without holes)', 'interaction_holes_bound');
        }
        return out;
    }
    function lengthBoundFailure(d) {
        if (!d || typeof d !== 'object' || d.pass !== false || d.utilization_valid !== false) { return null; }
        let best = null;
        const b = d.length_independent_bound;
        if (b && typeof b === 'object' && typeof b.ratio === 'number' && isFinite(b.ratio)) {
            best = { ratio: b.ratio, governing_check: b.governing_check_id || b.governing_check || null, limit_state: b.limit_state || null, basis: 'length', source: 'length_independent_bound' };
        } else {
            // 조합(H1.2): Pa · Max 를 그 하한으로 둔 H1.2 의 하한 비(interaction_length_bound)가 1 을 넘으면 — 항목 member.axial_bending
            const ib = d.interaction_length_bound;
            const t = ib && typeof ib === 'object' ? (typeof ib.total_unrounded === 'number' ? ib.total_unrounded : ib.total) : null;
            if (typeof t === 'number' && isFinite(t) && t > 1) {
                const has = Array.isArray(d.design_checks) && d.design_checks.some((c) => c && c.id === 'member.axial_bending');
                best = { ratio: t, governing_check: has ? 'member.axial_bending' : null, limit_state: 'H1.2 (Pa, Max at their length-independent bounds, B1 = 1)', basis: 'length', source: 'interaction_length_bound' };
            }
        }
        for (const c of holesBoundCandidates(d)) { if (!best || c.ratio > best.ratio) { best = c; } }
        return best;
    }

    return {
        fmt, logspace, convexHull,
        verdictOf, combineVerdicts, notEvaluatedList, warningsList, ratioWithVerdict,
        assumptionsList, scopeNotesList, userText, USER_TERMS, checkReason, purlinLists,
        pickGoverningPurlinDesign, deriveLapSection, withUnroundedValues, lengthBoundFailure, governingLapSupport, governingLapChoice, lapTwoMembers, lapMembersFromSections, applyLapTwoMembers,
        boundFailure: lengthBoundFailure, failsWithoutHoles, boundFailureText, FAILS_WITHOUT_HOLES, inputErrorText,
    };
});
