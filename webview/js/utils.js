// StcfsdUtils — DOM 무의존 순수 유틸 (app.js에서 분리, 0926 후속-1).
// UMD: 브라우저에서는 globalThis.StcfsdUtils, node 테스트에서는 require.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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

    /** 엔진의 「평가하지 못한 것」 목록(키 이름이 모듈마다 다르다)을 사람이 읽는 문장 목록으로. */
    function notEvaluatedList(result) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const push = (item) => {
            const s = _itemText(item);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        };
        // 접합부는 not_evaluated_relevant 가 판정을 막는 것(not_evaluated 는 정보 포함 전체)이다.
        const keys = ['not_evaluated_relevant', 'not_evaluated', 'checks_not_evaluated'];
        for (const k of keys) {
            const v = result[k];
            if (Array.isArray(v)) { v.forEach(push); }
            else if (typeof v === 'string' && v) { push(v); }
        }
        return out;
    }

    /** 엔진 경고 목록(문자열 배열) — 중복 제거. */
    function warningsList(result) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const add = (w) => {
            const s = _itemText(w);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        };
        if (Array.isArray(result.warnings)) { result.warnings.forEach(add); }
        if (typeof result.warning === 'string' && result.warning) { add(result.warning); }
        if (typeof result.dsm_warning === 'string' && result.dsm_warning) { add(result.dsm_warning); }
        return out;
    }

    function _listOf(result, key) {
        if (!result || typeof result !== 'object') { return []; }
        const out = [];
        const seen = new Set();
        const v = result[key];
        const items = Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : []);
        items.forEach((it) => {
            const s = _itemText(it);
            if (s && !seen.has(s)) { seen.add(s); out.push(s); }
        });
        return out;
    }

    /** 엔진 가정 목록(FIXES §3.1.1 — 기본값 입력·해석식 대체·보수 대체·자체 해석). */
    function assumptionsList(result) { return _listOf(result, 'assumptions'); }

    /** 범위 안내(언제나 참인 적용 범위 문장) — 접어서 보인다. */
    function scopeNotesList(result) { return _listOf(result, 'scope_notes'); }

    /** 이용률(비) 표시값. 판정이 OK 가 아니면 「OK」 문구를 붙이지 않는다. */
    function ratioWithVerdict(ratio, result) {
        const v = verdictOf(result);
        const pct = (typeof ratio === 'number' && isFinite(ratio)) ? (ratio * 100).toFixed(1) + '%' : '—';
        return pct + ' ' + v.short;
    }

    return {
        fmt, logspace, convexHull,
        verdictOf, combineVerdicts, notEvaluatedList, warningsList, ratioWithVerdict,
        assumptionsList, scopeNotesList, userText, USER_TERMS,
    };
});
