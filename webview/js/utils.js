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
            controlling_mode: `${gov.label}: ${design.controlling_mode || ''}`.trim(),
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
            design_positive: data.design_positive || null,
            design_negative: data.design_negative || null,
            design_lap: data.design_lap || null,
            design_uplift: data.design_uplift || null,
            uplift_R: data.uplift_R,
            deck: data.deck || null,
            span_type: data.span_type || '',
        };
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
        const none = (reason) => ({ Se: null, Vn: null, from: null, regions: [], support: Number.isInteger(support) ? support : null, reason });
        if (!purlin || !Array.isArray(purlin.regions)) { return none('no purlin design result — the lap section strength is taken only from the purlin result\'s lap region'); }
        if (!Number.isInteger(support) || support < 1) { return none('the support the lap spans is not set (lap support number)'); }
        if (!(opts && opts.stated)) { return none('the lap restraint is not stated — the lap section strength with Fn = Fy (Manual II-2A) is not derived'); }
        const regs = purlin.regions.filter((g) => g && g.kind === 'lap' && Number(g.support) === support - 1 && g.result && !g.result.error);
        if (regs.length === 0) { return none('the purlin result has no lap region at support ' + support); }
        let Se = null, Vn = null;
        const ids = [];
        for (const g of regs) {
            const r = g.result;
            const fy = Number(r.Fy_used);
            // 반올림 전 값(검토 항목의 nominal — 엔진 계약), 없으면 결과 필드(표시 반올림)
            const nominalOf = (id) => {
                const c = Array.isArray(r.design_checks) ? r.design_checks.find((x) => x && x.id === id) : null;
                return c && c.nominal && typeof c.nominal.value === 'number' && isFinite(c.nominal.value) ? c.nominal.value : null;
            };
            const mnl = nominalOf('member.flexure.local') ?? Number(r.Mnl);
            if (!(mnl > 0) || !(fy > 0)) { return none('the lap region ' + g.id + ' has no local-buckling strength (Mnl)'); }
            // 엔진 733c18e(계약 §6.3): Se 는 비탄성 여유 · 냉간 가공 없이 낸 랩 구간의 Mnℓ / Fy. 그 결과가 둘 가운데 하나를 품으면
            // (Mne > My — 비탄성 여유, Fy_used > Fy_original — 냉간 가공) 그 값이 결과에 없다 — 짓지 않는다(호스트는 강도를 계산하지 않는다)
            const my = Number(r.My), mne = Number(r.Mne), fyo = Number(r.Fy_original);
            if (my > 0 && mne > my * (1 + 1e-9)) { return none('the purlin lap region ' + g.id + ' was designed with inelastic reserve (Mne > My) — its Mnl is not the lap section strength; the result has no Mnl without the reserve'); }
            if (fyo > 0 && fy > fyo * (1 + 1e-9)) { return none('the purlin lap region ' + g.id + ' was designed with cold work (Fy_used > Fy) — its Mnl is not the lap section strength'); }
            const se = mnl / fy;
            if (Se === null || se < Se) { Se = se; }
            const vn = nominalOf('member.shear') ?? Number(r.Vn || (r.shear && r.shear.Vn));
            if (vn > 0 && (Vn === null || vn < Vn)) { Vn = vn; }
            ids.push(String(g.id));
        }
        return { Se, Vn, from: 'Mnl / Fy of the purlin lap region' + (ids.length > 1 ? 's ' : ' ') + ids.join(', ') + ' at support ' + support + ' (per member, Fn = Fy under the lap restraint statement)',
            regions: ids, support, reason: null };
    }

    return {
        fmt, logspace, convexHull,
        verdictOf, combineVerdicts, notEvaluatedList, warningsList, ratioWithVerdict,
        assumptionsList, scopeNotesList, userText, USER_TERMS,
        pickGoverningPurlinDesign, deriveLapSection,
    };
});
