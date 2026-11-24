/* global module, globalThis, require */
/**
 * K3 — 검증 · 보고서(순수 · UMD). 호스트(StcfsdPanel)가 require 하고, 화면(app.js)도 같은 것을 부른다.
 *
 * make(env) — 한 번의 검증 · 보고서를 만드는 묶음. env:
 *   doc        칸을 읽는 문서(getElementById · querySelector · querySelectorAll). 화면은 진짜 document,
 *              호스트는 검토 상태 · 모델로 만든 가짜 문서(src/case/reviewInput.ts — 칸의 글은 화면이 적는 12 자리 글)
 *   unitSystem 'SI' | 'US' — 보이는 단위
 *   model · analysisResult · lastDsmResult · lastProps · design · load · lap — 화면이 쥐는 결과의 사본(호스트는 그 거울)
 *   analysisCurrent 해석이 지금 모델의 것인가(호스트만 안다 — K3-6) · reportToSI ReportDoc(US) → SI(호스트의 siUnits — K3-7)
 * 보고서: buildReportDoc · buildBucklingDoc 이 데이터(ReportDoc, US + quantity)를, reportRender.js 가 HTML 을 만든다(K3-7).
 * 이 파일의 함수 몸은 app.js 에서 글 그대로 옮겼다(K3-1 · K3-4 — 값 · 글 · HTML 이 바이트까지 같게).
 * 고치는 것은 K3-6 부터, 각각 한 걸음씩(docs/implementation/20261124-k3-design.md 부록 A).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./utils.js'), require('./designState.js'), require('./reportRender.js'));
    } else {
        root.StcfsdReview = factory(root.StcfsdUtils, root.StcfsdDesignState, root.StcfsdReportRender);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (UTILS, DS, RENDER) {
    'use strict';
    const { fmt, verdictOf: _v3, userText } = UTILS;
    void fmt;
    // K4b: 엔진 알림의 경계(한국어 · 보이는 단위) — 브라우저는 StcfsdNotices, node 는 require
    const NOTICES = (typeof module === 'object' && module.exports) ? require('./notices.js') : globalThis.StcfsdNotices;

    // 단위 표 — app.js 의 UNIT 과 글 그대로(시험 review_contract 가 맞댄다)
    const _KIP_KN = 4.4482216152605, _IN_MM = 25.4, _IN_M = 0.0254, _FT_M = 0.3048;
    const UNIT = {
        // 변환 계수: US값 × factor = SI값
        length:   { factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 1} },
        length_ft:{ factor: 0.3048,    us: 'ft',    si: 'm',    decimals: {us: 2, si: 2} },
        area:     { factor: _IN_MM * _IN_MM,    us: 'in\u00B2',  si: 'mm\u00B2', decimals: {us: 4, si: 0} },
        inertia:  { factor: Math.pow(_IN_MM, 4),  us: 'in\u2074',  si: 'mm\u2074', decimals: {us: 4, si: 0} },
        modulus:  { factor: Math.pow(_IN_MM, 3), us: 'in\u00B3',  si: 'mm\u00B3', decimals: {us: 4, si: 0} },
        stress:   { factor: _KIP_KN * 1000 / (_IN_MM * _IN_MM),   us: 'ksi',   si: 'MPa',  decimals: {us: 1, si: 1} },
        force:    { factor: _KIP_KN,   us: 'kips',  si: 'kN',   decimals: {us: 2, si: 2} },
        moment:   { factor: _KIP_KN * _IN_M,   us: 'kip-in',si: 'kN-m', decimals: {us: 2, si: 2} },
        moment_ft:{ factor: _KIP_KN * _FT_M,   us: 'kip-ft',si: 'kN-m', decimals: {us: 2, si: 2} },
        pressure: { factor: _KIP_KN / 1000 / (_FT_M * _FT_M),   us: 'psf',   si: 'kPa',  decimals: {us: 1, si: 3} },
        linload:  { factor: _KIP_KN / 1000 / _FT_M,   us: 'plf',   si: 'kN/m', decimals: {us: 0, si: 3} },
        thickness:{ factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 2} },
        radius:   { factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 1} },
        rotStiff: { factor: _KIP_KN,   us: 'kip-in/rad/in', si: 'kN-m/rad/m', decimals: {us: 4, si: 4} },
        latStiff: { factor: _KIP_KN / (_IN_M * _IN_M), us: 'kip/in/in', si: 'kN/m/m', decimals: {us: 3, si: 1} },
        // 질량밀도: 1 kip·s²/in⁴ = 4448.22 N·s² / 0.0254⁴ m⁴ = 1.0687e10 kg/m³ (강재 7.345e-7 ↔ 7850)
        density:  { factor: _KIP_KN * 1000 / Math.pow(_IN_M, 4), us: 'kip·s²/in⁴', si: 'kg/m³', decimals: {us: 4, si: 0} },
    };

    /**
     * K3-6(결정 4): 검증의 공학 한계 — 값은 바꾸지 않고(원문과 다른 것만 원문으로) 한곳에. source 는 원문 조항(AISI S100-16, aisi-cold-formed-steel
     * 스킬의 원문 전사로 읽음)이거나 「프로그램 경험값」(원문 조항이 없는 점검). engine 은 엔진이 같은 한계를 보는 곳.
     */
    const THRESHOLDS = {
        t_min: { value: 0.018, unit: 'in', source: '프로그램 경험값(냉간성형 일반 범위 — 원문 한계 없음)' },
        t_max: { value: 0.5, unit: 'in', source: '프로그램 경험값(냉간성형 일반 범위 — 원문 한계 없음)' },
        web_wt: { value: 500, criterion: '압축 웹 w/t ≤ 500 (표 B4.1-1, DSM — 보강 압축 요소)', source: '표 B4.1-1', engine: 'aisi_s100.check_dsm_limits web w/t 500' },
        web_ht: { value: 300, criterion: '휨 웹 h/t ≤ 300 (표 B4.1-1, DSM — 휨을 받는 보강 요소)', source: '표 B4.1-1', engine: 'check_dsm_limits web h/t 300' },
        web_note_b: { value: 250, criterion: 'w/t > 250 이면 변형이 눈에 띔 (표 B4.1-1 주석 b)', source: '표 B4.1-1 주석 b' },
        flange_bt: { value: 160, criterion: '에지보강 플랜지 b/t ≤ 160 (표 B4.1-1, DSM)', source: '표 B4.1-1', engine: 'check_dsm_limits flange b/t 160' },
        lip_dt: { value: 60, criterion: '비보강 요소(립) d/t ≤ 60 (표 B4.1-1)', source: '표 B4.1-1', engine: 'check_dsm_limits lip d/t 60' },
        unstiff_dt_note: { value: 30, criterion: 'd/t > 30 이면 변형이 눈에 띔 (표 B4.1-1 주석 b)', source: '표 B4.1-1 주석 b' },
        corner_rt: { value: 20, criterion: '안쪽 굽힘 반경 R/t ≤ 20 (표 B4.1-1, DSM)', source: '표 B4.1-1', engine: 'check_dsm_limits corner R/t 20' },
        fy_max: { value: 95, unit: 'ksi', source: '표 B4.1-1(DSM 적용 한계 — 부등호 strict)', engine: 'check_dsm_limits Fy < 95 (strict)' },
        fu_fy: { value: 1.08, criterion: 'Fu/Fy ≥ 1.08 (§I6.2.1(o) — R 계수법의 조건)', source: '§I6.2.1(o)', engine: 'bracing.py i621 (o)' },
        span_i621: { value: 33, unit: 'ft', criterion: '§I6.2.1(h) R 계수법: 경간 ≤ 33 ft', source: '§I6.2.1(h)', engine: 'bracing.py i621 (h) span <= 33 ft' },
        spacing_max: { value: 8, unit: 'ft', source: '프로그램 경험값(원문 한계 없음)' },
        len_min_ratio: { value: 0.8, source: '프로그램 경험값(원문 조항 없음 — 서명곡선의 국부 극소 포착)' },
        len_min_abs: { value: 5, unit: 'in', source: '프로그램 경험값' },
        len_max_ref: { value: 120, unit: 'in', source: '프로그램 경험값(비교 길이의 하한)' },
        len_max_factor: { value: 1.5, source: '프로그램 경험값' },
        len_count: { value: 30, source: '프로그램 경험값' },
        deflection_roof: { LL: 240, TL: 180, label: '지붕 퍼린', source: '건축 기준의 처짐 한계(IBC Table 1604.3 — AISI S100 §L 은 수를 정하지 않는다; 값은 이전 그대로, 이 스킬로 대조하지 못함)' },
        deflection_floor: { LL: 360, TL: 240, label: '바닥 장선', source: '건축 기준의 처짐 한계(IBC Table 1604.3 — AISI S100 §L 은 수를 정하지 않는다; 값은 이전 그대로, 이 스킬로 대조하지 못함)' },
        deflection_margin: { value: 1.1, source: '프로그램 경험값(한계 근접 주의)' },
        b4_engine: { criterion: '표 B4.1-1 적용 한계 — 엔진이 평탄폭 · 요소 종류로 대조(member.applicability.b4)', source: '표 B4.1-1' },
    };

    function make(env) {
        const document = env.doc;
        const _unitSystem = env.unitSystem === 'US' ? 'US' : 'SI';
        // K4b: 목록 도우미는 보이는 단위로 그린 한국어 알림(옛 글은 알림이 없을 때만)
        const _uo = { units: _unitSystem };
        const _notEvalList = (r) => UTILS.notEvaluatedList(r, _uo);
        const _warnList = (r) => UTILS.warningsList(r, _uo);
        const _assumpList = (r) => UTILS.assumptionsList(r, _uo);
        const _scopeList = (r) => UTILS.scopeNotesList(r, _uo);
        /** 호스트가 옮겨 담은 옛 글(dsm_warnings · purlin_* · 검토 지점의 가정)을 같은 알림의 한국어로 */
        const _koText = NOTICES ? NOTICES.textMap([env.design, env.load, env.lap, env.lastDsmResult], { units: _unitSystem, lang: 'ko' }) : (x) => x;
        const _koCheck = (c) => (NOTICES ? NOTICES.readerCheck(c, _uo) : c);
        const model = env.model || null;
        // K4b: 결과의 글 필드 · 알림 사전 · 모드 이름을 한국어 · 보이는 단위로(목록 · 알림 · 검토 항목은 그대로 — 아래 도우미가 그린다)
        const _fp = (r) => (NOTICES && r && typeof r === 'object' && !Array.isArray(r) ? NOTICES.forPage(r, env.unitSystem === 'US' ? 'US' : 'SI') : r);
        const analysisResult = _fp(env.analysisResult) || null;
        const lastDsmResult = _fp(env.lastDsmResult) || null;
        const lastProps = env.lastProps || null;
        const _lastDesignResult = _fp(env.design) || null;
        const _lastLoadAnalysis = _fp(env.load) || null;
        const _lastLapResult = _fp(env.lap) || null;

        function toDisplay(usValue, unitType) {
            if (_unitSystem === 'US' || !UNIT[unitType]) return usValue;
            return usValue * UNIT[unitType].factor;
        }

        function fromDisplay(displayValue, unitType) {
            if (_unitSystem === 'US' || !UNIT[unitType]) return displayValue;
            return displayValue / UNIT[unitType].factor;
        }

        function unitLabel(unitType) {
            const u = UNIT[unitType];
            if (!u) return '';
            return _unitSystem === 'SI' ? u.si : u.us;
        }

        function unitDec(unitType) {
            const u = UNIT[unitType];
            if (!u) return 2;
            return _unitSystem === 'SI' ? u.decimals.si : u.decimals.us;
        }

        function fmtVal(usValue, unitType) {
            if (usValue == null || isNaN(usValue)) return '\u2014';
            const v = toDisplay(usValue, unitType);
            return v.toFixed(unitDec(unitType));
        }

        function getNum(id, fallback) {
            const el = document.getElementById(id);
            const v = el ? parseFloat(el.value) : NaN;
            if (!isNaN(v)) return v;
            // 빈 칸은 호출자의 fallback(표시 · 화면 연동용). 계산 요청은 reqNum · zeroNum · _optNum 을 쓴다(V4-06).
            return fallback;
        }

        function _optNum(id, unitType) {
            const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
            if (!el) { return undefined; }
            const ex = unitType ? DS.exactOf(el) : undefined;
            if (ex !== undefined) { return ex; }
            const raw = String(el.value || '').trim();
            if (raw === '') { return undefined; }
            const v = parseFloat(raw);
            if (!isFinite(v)) { return undefined; }
            return unitType ? fromDisplay(v, unitType) : v;
        }

        // V7-02: 글을 넣는 함수는 하나 — reportRender.esc(& < > " ' 를 모두)
        function _esc(s) { return RENDER.esc(s); }

        function _ratioVerdict(ratio, evaluated) {
            if (typeof ratio === 'number' && isFinite(ratio) && ratio > 1.0) { return _v3(false); }
            if (evaluated === true && typeof ratio === 'number' && isFinite(ratio)) { return _v3(true); }
            return _v3(null);
        }

        function _checkVerdict(res, name, ratio) {
            const lsc = res && Array.isArray(res.limit_state_checks) ? res.limit_state_checks : [];
            const hit = lsc.find(c => c && c.name === name);
            if (hit) { return _v3(hit); }
            return _ratioVerdict(ratio, !!res && res.pass === true);
        }

        function _regionLabel(lbl) {
            const s = String(lbl || '');
            if (_unitSystem !== 'SI') { return s; }
            return s.replace(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) ft/g, (m0, a, b) =>
                fmtVal(Number(a), 'length_ft') + '–' + fmtVal(Number(b), 'length_ft') + ' ' + unitLabel('length_ft'));
        }

        function _deckNotes(deck) {
            const arr = (v) => Array.isArray(v) ? v.filter(Boolean).map(String) : [];
            if (!deck) { return { warnings: [], assumptions: [], scope: [] }; }
            const hasNew = Array.isArray(deck.warnings) || Array.isArray(deck.scope_notes) || Array.isArray(deck.assumptions);
            if (Array.isArray(deck.notices)) {
                // 옛 한 줄 warning 은 범위 안내의 사본 — 경고로 다시 싣지 않는다(화면 _deckNotes 와 같게)
                const dup = typeof deck.warning === 'string' && deck.notices.some((n) => n && n.list === 'scope_notes'
                    && ((deck.warning_code && n.code === deck.warning_code) || n.text === deck.warning || n.text_ko === deck.warning));
                return { warnings: _warnList(dup ? Object.assign({}, deck, { warning: undefined }) : deck), assumptions: _assumpList(deck), scope: _scopeList(deck) };
            }
            return {
                warnings: arr(deck.warnings),
                assumptions: arr(deck.assumptions),
                scope: hasNew ? arr(deck.scope_notes) : (deck.warning ? [String(deck.warning)] : []),
            };
        }

        function _rv(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 2) : '—'; }

        function _ruv(v, ut) { return fmtVal(v, ut); }

        function _rul(ut) { return unitLabel(ut); }
        /** V9a-06: 화면 칸에서 읽은 수(그 단위 그대로)를 보이는 자리로 — 유효숫자 4(「379.211651124 MPa」 → 「379.2 MPa」) */
        function _dn(v) { return typeof v === 'number' && isFinite(v) ? String(Number(v.toPrecision(4))) : String(v); }

        /** K3-6: 엔진 결과의 검토 항목(design_checks)에서 id 로 */
        function _engineCheck(r, id) {
            const list = r && Array.isArray(r.design_checks) ? r.design_checks : [];
            return list.find(c => c && c.id === id) || null;
        }
        /** 엔진 판정 → 검증 상태(엔진이 이긴다): pass · fail · 미평가는 주의, 해당 없음은 null(항목을 내지 않는다) */
        function _engineStatus(c) {
            if (!c) { return undefined; }
            if (c.verdict === 'pass') { return 'pass'; }
            if (c.verdict === 'fail') { return 'fail'; }
            if (c.verdict === 'not_applicable') { return null; }
            return 'warn';
        }
        /** 엔진 항목의 판정 글(검증 표의 주석) */
        function _engineNote(c) {
            if (!c) { return ''; }
            const nm = c.name_ko || c.name || c.id;
            if (c.verdict === 'pass') { return '엔진: ' + nm + ' — 통과'; }
            if (c.verdict === 'fail') { return '엔진: ' + nm + ' — 불합격'; }
            const why = UTILS.checkReason(c, _uo);
            return '엔진: ' + nm + ' — 판정 없음' + (why ? ' (' + why + ')' : '');
        }
        /** 끝없는 값(엔진 unbounded — Fcre = ∞)을 수로 적지 않는다 */
        function _fcreText(r) {
            if (!r) { return '—'; }
            if (r.Fcre_unbounded === true || (typeof r.Fcre === 'number' && r.Fcre >= 1e6)) { return '∞'; }
            return _ruv(r.Fcre, 'stress') + ' ' + _rul('stress');
        }

        function runAllValidationChecks() {
            const checks = [];
            const d = _lastDesignResult;
            const la = _lastLoadAnalysis;
            const p = lastProps;
            const dsm = lastDsmResult;
            // 빈 칸 = 0 → 아래 재료 검토가 「Fy 가 지정되지 않았습니다」로 실패한다(기본 강종으로 통과시키지 않는다).
            const fy = getNum('design-fy', 0);
            const fu = getNum('design-fu', 0);
            const H = getNum('tpl-H', 0), B = getNum('tpl-B', 0), D = getNum('tpl-D', 0);
            const t = getNum('tpl-t', 0), r = getNum('tpl-r', 0);
            const memberType0 = /** @type {HTMLSelectElement} */ (document.getElementById('select-member-type'))?.value || '';

            // ════════════════════════════════════════
            // A. 단면 입력
            // ════════════════════════════════════════
            const cat = 'A. 단면 입력';
            // K3-6(결정 3 · D17): 설계 결과에 엔진의 표 B4.1-1 대조가 있으면 그 판정을 하나로 보인다(평탄폭 · 요소 종류 · 휨 웹 h/t ≤ 300 —
            // 화면의 아래 칸 치수 점검은 예비 점검). 엔진이 넘었다고 하면 판정 없음(적용 범위 밖), 아니면 통과.
            const _b4 = _engineCheck(d, 'member.applicability.b4');
            if (_b4) {
                checks.push({
                    category: cat, item: '표 B4.1-1 적용 한계 (엔진)',
                    status: _b4.verdict === 'not_evaluated' ? 'warn' : (_b4.verdict === 'fail' ? 'fail' : 'pass'),
                    value: _b4.verdict === 'pass' ? '한계 안' : (_b4.reason || _b4.verdict),
                    criterion: THRESHOLDS.b4_engine.criterion,
                    note: _engineNote(_b4),
                });
            }

            checks.push({
                category: cat, item: '단면 정의',
                status: (model && model.node && model.node.length > 0) ? 'pass' : 'fail',
                value: model ? (model.node||[]).length + ' 절점' : '0',
                criterion: '최소 1개 절점 정의 필요',
                note: model && model.node && model.node.length > 0 ? '' : '단면 미정의 — ①단면·재료 탭에서 템플릿을 생성하거나 절점/요소를 정의하세요.',
            });

            checks.push({
                category: cat, item: '두께 (t)',
                status: t > 0 ? (t >= toDisplay(THRESHOLDS.t_min.value,'thickness') && t <= toDisplay(THRESHOLDS.t_max.value,'thickness') ? 'pass' : 'warn') : 'fail',
                value: t > 0 ? t+' '+_rul('thickness') : '미설정',
                criterion: _ruv(THRESHOLDS.t_min.value,'thickness')+' ≤ t ≤ '+_ruv(THRESHOLDS.t_max.value,'thickness')+' '+_rul('thickness')+' (' + THRESHOLDS.t_min.source + ')',
                note: t <= 0 ? '두께가 지정되지 않았습니다.' : (t < toDisplay(THRESHOLDS.t_min.value,'thickness') ? '매우 얇음 — 재료 가용성을 확인하세요.' : (t > toDisplay(THRESHOLDS.t_max.value,'thickness') ? '두꺼움 — 냉간성형이 아닐 수 있습니다.' : '')),
            });

            if (t > 0 && H > 0) {
                const wt_web = (H - 2*(t+r)) / t;
                // 표 B4.1-1(DSM): 압축 웹 w/t ≤ 500, 휨 웹 h/t ≤ 300(엔진과 같다). 주석 b: w/t > 250 이면 강도 전에 변형이 눈에 띈다
                const _webLim = (memberType0 === 'compression' || memberType0 === 'wall-stud') ? THRESHOLDS.web_wt : THRESHOLDS.web_ht;
                checks.push({
                    category: cat, item: '웹 w/t 비',
                    status: wt_web <= THRESHOLDS.web_note_b.value ? 'pass' : (wt_web <= _webLim.value ? 'warn' : 'fail'),
                    value: wt_web.toFixed(1),
                    criterion: _webLim.criterion + ' · ' + THRESHOLDS.web_note_b.criterion,
                    note: wt_web > _webLim.value ? '적용 한계 초과 — ' + _webLim.source + '.' : (wt_web > THRESHOLDS.web_note_b.value ? THRESHOLDS.web_note_b.source + ': 강도 전에 변형이 눈에 띌 수 있습니다.' : ''),
                });
            }
            if (t > 0 && B > 0) {
                const bt_fl = (B - 2*(t+r)) / t;
                checks.push({
                    category: cat, item: '플랜지 b/t 비',
                    status: bt_fl <= THRESHOLDS.flange_bt.value ? 'pass' : 'fail',
                    value: bt_fl.toFixed(1),
                    criterion: THRESHOLDS.flange_bt.criterion,
                    note: bt_fl > THRESHOLDS.flange_bt.value ? '적용 한계 초과 — ' + THRESHOLDS.flange_bt.source + '.' : '',
                });
            }
            if (t > 0 && D > 0) {
                const dt_lip = D / t;
                checks.push({
                    category: cat, item: '립 d/t 비',
                    status: dt_lip <= THRESHOLDS.unstiff_dt_note.value ? 'pass' : (dt_lip <= THRESHOLDS.lip_dt.value ? 'warn' : 'fail'),
                    value: dt_lip.toFixed(1),
                    criterion: THRESHOLDS.lip_dt.criterion + ' · ' + THRESHOLDS.unstiff_dt_note.criterion,
                    note: dt_lip > THRESHOLDS.lip_dt.value ? '적용 한계 초과 — ' + THRESHOLDS.lip_dt.source + '.' : (dt_lip > THRESHOLDS.unstiff_dt_note.value ? THRESHOLDS.unstiff_dt_note.source + ': 강도 전에 변형이 눈에 띌 수 있습니다.' : ''),
                });
            }
            if (r > 0 && t > 0) {
                const Rt = r / t;
                checks.push({
                    category: cat, item: '코너 R/t 비',
                    status: Rt <= THRESHOLDS.corner_rt.value ? 'pass' : 'fail',
                    value: Rt.toFixed(1),
                    criterion: THRESHOLDS.corner_rt.criterion,
                    note: Rt > THRESHOLDS.corner_rt.value ? '적용 한계 초과 — ' + THRESHOLDS.corner_rt.source + '.' : '',
                });
            }

            // ════════════════════════════════════════
            // B. 재료
            // ════════════════════════════════════════
            const catB = 'B. 재료';

            checks.push({
                category: catB, item: '항복강도 (Fy)',
                status: fy > 0 ? (fy < toDisplay(THRESHOLDS.fy_max.value,'stress') ? 'pass' : 'fail') : 'fail',
                value: _dn(fy)+' '+_rul('stress'),
                criterion: 'Fy < '+_ruv(THRESHOLDS.fy_max.value,'stress')+' '+_rul('stress')+' (' + THRESHOLDS.fy_max.source + ')',
                note: fy >= toDisplay(THRESHOLDS.fy_max.value,'stress') ? '적용 한계 초과 — ' + THRESHOLDS.fy_max.source + '.' : (fy <= 0 ? 'Fy가 지정되지 않았습니다.' : ''),
            });

            checks.push({
                category: catB, item: 'Fu/Fy 비',
                status: fy > 0 && fu > 0 ? (fu/fy >= THRESHOLDS.fu_fy.value ? 'pass' : 'warn') : 'fail',
                value: fy > 0 && fu > 0 ? (fu/fy).toFixed(3) : 'N/A',
                criterion: THRESHOLDS.fu_fy.criterion,
                note: fy > 0 && fu > 0 && fu/fy < THRESHOLDS.fu_fy.value ? '낮은 연성비 — §I6.2.1(o): R 계수법을 쓸 수 없습니다.' : '',
            });

            checks.push({
                category: catB, item: '인장강도 (Fu)',
                status: fu > 0 ? (fu > fy ? 'pass' : 'fail') : 'fail',
                value: _dn(fu)+' '+_rul('stress'),
                criterion: 'Fu > Fy',
                note: fu <= fy ? 'Fu는 Fy보다 커야 합니다.' : '',
            });

            // ════════════════════════════════════════
            // C. 좌굴 해석
            // ════════════════════════════════════════
            const catC = 'C. 좌굴 해석';

            // 반파장 설정 검증
            // K3-6(D19): 반파장은 모델의 길이 목록에서(US in) — 칸이 비면 화면 단위의 1000 을 읽던 것(US 1000 in · SI 1000 mm)을 없앴다
            const _L = model && Array.isArray(model.lengths) ? model.lengths.map(Number).filter(v => isFinite(v) && v > 0) : [];
            const _lenField = (id, unit) => _optNum(id, unit);
            const lenMin = _L.length ? Math.min(..._L) : _lenField('input-len-min', 'length');
            const lenMax = _L.length ? Math.max(..._L) : _lenField('input-len-max', 'length');
            const lenN = _L.length ? _L.length : _lenField('input-len-n', null);
            const _lenKnown = lenMin !== undefined && lenMax !== undefined && lenN !== undefined;
            const bcVal = /** @type {HTMLSelectElement} */ (document.getElementById('select-bc'))?.value || 'S-S';
            const webH = fromDisplay(getNum('tpl-H', 0), 'length'); // 웹 높이 (US in)

            // 최솟값 검증: 국부좌굴 포착을 위해 단면 높이의 0.8 배 이하(높이를 모르면 5 in) — 프로그램 경험값(D14: 기준 · 주석의 수를 하나로)
            const _minLim = webH > 0 ? webH * THRESHOLDS.len_min_ratio.value : THRESHOLDS.len_min_abs.value;
            const localOK = _lenKnown && lenMin <= _minLim;
            checks.push({
                category: catC, item: '반파장 최솟값',
                status: !_lenKnown ? 'fail' : (localOK ? 'pass' : 'warn'),
                value: _lenKnown ? _ruv(lenMin,'length')+' '+_rul('length') : '미설정',
                criterion: '국부좌굴 포착: 최솟값 ≤ ' + (webH > 0 ? '0.8 × 단면 높이(' + _ruv(_minLim,'length') + ' ' + _rul('length') + ')' : _ruv(_minLim,'length') + ' ' + _rul('length')) + ' (' + THRESHOLDS.len_min_ratio.source + ')',
                note: !_lenKnown ? '반파장 범위가 없습니다 — 해석 조건을 정하세요.' : (!localOK ? '최솟값이 너무 큼 — 국부좌굴 곡선이 잘릴 수 있습니다. ' + _ruv(_minLim,'length') + ' ' + _rul('length') + ' 이하로 설정하세요.' : ''),
            });

            // 최댓값 검증: 전체좌굴 포착을 위해 비지지 길이 이상이어야 함
            const designLb = fromDisplay(getNum('design-Lb', 0), 'length');
            const spanTblEls2 = Array.from(document.querySelectorAll('.span-tbl-len'));
            const spanIn = spanTblEls2.length > 0
                ? Math.max(...spanTblEls2.map(el => fromDisplay(parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0, 'length_ft') * 12))
                : 0;
            const refLen = Math.max(designLb, spanIn, THRESHOLDS.len_max_ref.value); // 비교용 참조 길이 (in)
            const globalOK = _lenKnown && lenMax >= refLen;
            checks.push({
                category: catC, item: '반파장 최댓값',
                status: globalOK ? (lenMax >= refLen * THRESHOLDS.len_max_factor.value ? 'pass' : 'warn') : 'fail',
                value: _lenKnown ? _ruv(lenMax,'length')+' '+_rul('length') : '미설정',
                criterion: '전체좌굴 포착을 위해 최댓값 ≥ 비지지 길이(≈'+_ruv(refLen,'length')+' '+_rul('length')+') 필요. 1.5~3배 권장',
                note: !globalOK ? '최댓값이 비지지 길이보다 짧음 — 전체좌굴(LTB)이 곡선에 나타나지 않습니다. 최소 '+_ruv(refLen*1.5,'length')+' '+_rul('length')+' 이상으로 설정하세요.' : (lenMax < refLen * 1.5 ? '비지지 길이의 1.5배 미만 — 전체좌굴 영역이 부족할 수 있습니다.' : ''),
            });

            // 개수 검증
            checks.push({
                category: catC, item: '반파장 개수',
                status: !_lenKnown ? 'fail' : (lenN >= THRESHOLDS.len_count.value ? 'pass' : 'warn'),
                value: _lenKnown ? lenN + '점' : '미설정',
                criterion: '곡선 해상도 ≥ 30점 권장 (일반 50점, 복잡단면 80~100점)',
                note: lenN < 30 ? '점 수가 부족하면 좌굴 최솟값을 놓칠 수 있습니다.' : '',
            });

            // 경계조건 검증
            const loadCase = /** @type {HTMLSelectElement} */ (document.getElementById('select-load-case'))?.value || 'compression';
            const memberApp2 = /** @type {HTMLSelectElement} */ (document.getElementById('select-member-type'))?.value || '';
            let bcExpected = 'S-S';
            let bcNote = '';
            if (memberApp2 === 'roof-purlin' || memberApp2 === 'floor-joist' || memberApp2 === 'wall-girt') {
                bcExpected = 'S-S';
                bcNote = '퍼린/장선/거트는 일반적으로 S-S (단순-단순) 사용';
            } else if (memberApp2 === 'wall-stud') {
                bcExpected = 'S-S';
                bcNote = '벽 스터드는 일반적으로 S-S 사용 (상하단 트랙 지지)';
            }
            checks.push({
                category: catC, item: '경계조건 (BC)',
                // K3-6(D6): 늘 통과였다 — 퍼린 · 장선 · 거트 · 스터드인데 S-S 가 아니면 주의(그 밖은 판단에 맡긴다: 통과)
                status: bcNote && bcVal !== bcExpected ? 'warn' : 'pass',
                value: bcVal,
                criterion: bcNote || '부재 양단 지지 상태에 맞는 경계조건 선택 필요',
                note: bcVal !== bcExpected && bcNote ? '현재 '+bcVal+' 설정됨 — '+bcNote+'.' : '',
            });

            // Load Case vs 설계 부재유형 일관성
            const isFlexureMember = (memberApp2 === 'roof-purlin' || memberApp2 === 'floor-joist' || memberApp2 === 'wall-girt' || memberApp2 === 'flexure');
            const isCompMember = (memberApp2 === 'wall-stud' || memberApp2 === 'compression');
            let lcOK = true;
            let lcNote = '';
            if (isFlexureMember && loadCase === 'compression') {
                lcOK = false;
                lcNote = '휨 부재인데 압축 Load Case가 선택됨 — 강축 휨 (+Mxx 또는 -Mxx)으로 변경하세요.';
            } else if (isCompMember && loadCase !== 'compression' && loadCase !== 'custom') {
                lcOK = false;
                lcNote = '압축 부재인데 휨 Load Case가 선택됨 — 압축(Compression)으로 변경하세요.';
            }
            checks.push({
                category: catC, item: 'Load Case 적합성',
                // K3-6(D3): 퍼린 묶음 설계는 하중 경우를 스스로 정해 정 · 부모멘트 서명곡선을 돌린다 — 화면의 해석 칸과 견주지 않는다
                status: (d && d.purlin_mode === true) ? 'pass' : (lcOK ? 'pass' : 'warn'),
                value: (d && d.purlin_mode === true) ? '퍼린 설계가 정 · 부모멘트로 따로 해석' : loadCase,
                criterion: '설계 부재유형과 해석 Load Case가 일치해야 함',
                note: (d && d.purlin_mode === true) ? '' : lcNote,
            });

            checks.push({
                category: catC, item: '해석 실행 여부',
                status: (analysisResult && analysisResult.curve) || (d && d.purlin_mode === true) ? 'pass' : 'fail',
                value: analysisResult && analysisResult.curve ? analysisResult.curve.length + ' 점' : ((d && d.purlin_mode === true) ? '퍼린 설계의 서명곡선(정 · 부모멘트)' : '미실행'),
                criterion: '설계 전 FSM 좌굴해석 완료 필요',
                note: !analysisResult && !(d && d.purlin_mode === true) ? '③좌굴해석·부재설계 탭의 "A. 좌굴해석"에서 해석을 실행하세요.' : '',
            });

            const dP = dsm ? dsm.P : null;
            const dM = dsm ? dsm.Mxx : null;

            checks.push({
                category: catC, item: 'DSM 값 추출',
                status: dP || dM || (d && d.purlin_mode === true) ? 'pass' : 'fail',
                value: dP ? 'Pcrl='+_rv(dP.crl)+', Pcrd='+_rv(dP.crd) : ((d && d.purlin_mode === true) ? '퍼린 설계의 DSM(정 · 부모멘트)' : '미추출'),
                criterion: 'Pcrl, Pcrd, Mcrl, Mcrd가 시그니처 곡선에서 식별되어야 함',
                note: !dP && !dM && !(d && d.purlin_mode === true) ? '해석을 먼저 실행하세요 — DSM 값은 자동 추출됩니다.' : '',
            });

            if (dM) {
                checks.push({
                    category: catC, item: 'Mcrl 식별 (국부좌굴)',
                    status: dM.crl > 0 ? 'pass' : 'warn',
                    value: dM.crl > 0 ? _ruv(dM.crl,'moment')+' '+_rul('moment')+' (L='+_ruv(dM.Lcrl,'length')+' '+_rul('length')+')' : '미발견',
                    criterion: '국부좌굴 최솟값이 식별 가능해야 함',
                    note: dM.crl <= 0 ? '국부좌굴 최솟값 미발견 — 국부검토를 건너뜁니다 (Mnl=Mne).' : '',
                });
                // Mcrd: FSM 미발견 시 해석적 fallback 가능 여부 확인
                const hasFsmMcrd = dM.crd > 0;
                const hasSectionInfo = H > 0 && B > 0 && D > 0 && t > 0;
                const canFallback = !hasFsmMcrd && hasSectionInfo;
                let mcrdNote = '';
                if (hasFsmMcrd) {
                    mcrdNote = '';
                } else if (canFallback) {
                    mcrdNote = 'FSM 곡선에서 뒤틀림 극소 미검출 → 설계 시 Appendix 2 §2.3.3.3 해석적 공식으로 자동 계산됩니다.';
                } else {
                    mcrdNote = '뒤틀림좌굴 미발견, 단면 정보 부족으로 해석적 fallback 불가 — Mnd=My. 에지 보강재 유무를 확인하세요.';
                }
                checks.push({
                    category: catC, item: 'Mcrd 식별 (뒤틀림좌굴)',
                    status: hasFsmMcrd ? 'pass' : (canFallback ? 'warn' : 'warn'),
                    value: hasFsmMcrd
                        ? _ruv(dM.crd,'moment')+' '+_rul('moment')+' (L='+_ruv(dM.Lcrd,'length')+' '+_rul('length')+')'
                        : (canFallback ? 'FSM 미발견 → §2.3.3.3 fallback' : '미발견'),
                    criterion: 'C/Z 단면에서 뒤틀림좌굴이 식별되어야 함. 미발견 시 해석적 공식(§2.3.3.3) 사용.',
                    note: mcrdNote,
                });
            }

            // ════════════════════════════════════════
            // D. 단면 성질
            // ════════════════════════════════════════
            const catD = 'D. 단면 성질';

            checks.push({
                category: catD, item: '성질 계산 여부',
                status: p ? 'pass' : 'fail',
                value: p ? 'A='+_ruv(p.A,'area')+' '+_rul('area') : '미계산',
                criterion: '설계에 단면 성질이 필요합니다',
                note: !p ? '①단면·재료 탭에서 "성질 계산"을 클릭하세요.' : '',
            });

            if (p) {
                checks.push({
                    category: catD, item: '단면계수 Sx',
                    status: p.Sx > 0 ? 'pass' : 'fail',
                    value: p.Sx > 0 ? _ruv(p.Sx,'modulus')+' '+_rul('modulus') : '0 또는 N/A',
                    criterion: '휨 설계에 Sx > 0 필요 (Sf)',
                    note: p.Sx <= 0 ? '단면계수가 0 — My=Sf×Fy를 계산할 수 없습니다.' : '',
                });
                checks.push({
                    category: catD, item: '회전반경 rx, rz',
                    status: p.rx > 0 && p.rz > 0 ? 'pass' : 'warn',
                    value: 'rx='+_ruv(p.rx,'length')+', rz='+_ruv(p.rz,'length')+' '+_rul('length'),
                    criterion: '기둥/LTB 설계에 rx, rz > 0 필요',
                    note: (p.rx <= 0 || p.rz <= 0) ? '회전반경이 0 — 단면 형상을 확인하세요.' : '',
                });
            }

            // ════════════════════════════════════════
            // E. 하중 입력 (Load Input)
            // ════════════════════════════════════════
            const catE = 'E. 하중 입력';
            // K3-6: 빈 칸을 3.281 로 지어 읽지 않는다(빈 칸 = 미설정)
            const spacing = getNum('config-spacing', 0);
            // config-span 요소가 없으므로 스팬 테이블에서 첫 번째 스팬 길이를 읽음
            const spanTblEls = document.querySelectorAll('.span-tbl-len');
            let spanFt = 0;
            if (spanTblEls.length > 0) {
                spanFt = Math.max(...Array.from(spanTblEls).map(el => parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0));
            }
            const loadD = getNum('load-D-psf', 0);
            const loadLr = getNum('load-Lr-psf', 0);
            const loadS = getNum('load-S-psf', 0);
            const loadL = getNum('load-L-psf', 0);
            checks.push({
                category: catE, item: '스팬 길이',
                // K3-6(D7): 판정과 기준 · 주석이 40 / 33 ft 로 달랐다 — 원문 §I6.2.1(h) 와 엔진(bracing.py (h))이 33 ft
                status: spanFt > 0 ? (spanFt <= toDisplay(THRESHOLDS.span_i621.value,'length_ft') ? 'pass' : 'warn') : 'fail',
                value: spanFt > 0 ? spanFt+' '+_rul('length_ft') : '미설정',
                criterion: '스팬 > 0; ' + THRESHOLDS.span_i621.criterion.replace('33 ft', _ruv(THRESHOLDS.span_i621.value,'length_ft')+' '+_rul('length_ft')),
                note: spanFt <= 0 ? '스팬 길이를 설정하세요.' : (spanFt > toDisplay(THRESHOLDS.span_i621.value,'length_ft') ? THRESHOLDS.span_i621.source + ' 를 넘음 — 양력 R 계수법(§I6.2.1)을 쓸 수 없습니다.' : ''),
            });

            checks.push({
                category: catE, item: '분담폭 (간격)',
                status: spacing > 0 ? (spacing <= toDisplay(THRESHOLDS.spacing_max.value,'length_ft') ? 'pass' : 'warn') : 'fail',
                value: _dn(spacing)+' '+_rul('length_ft'),
                criterion: '간격 > 0; 일반 '+_ruv(4,'length_ft')+'-'+_ruv(6,'length_ft')+' '+_rul('length_ft'),
                note: spacing > toDisplay(8,'length_ft') ? '큰 간격 — 하중 분배를 확인하세요.' : '',
            });

            checks.push({
                category: catE, item: '고정하중 (D)',
                status: loadD > 0 ? 'pass' : 'warn',
                value: _dn(loadD)+' '+_rul('pressure'),
                criterion: 'D > 0 예상 (자중 + 지붕재)',
                note: loadD <= 0 ? '고정하중 없음? 자중은 포함해야 합니다. 일반: '+_ruv(5,'pressure')+'-'+_ruv(15,'pressure')+' '+_rul('pressure')+'.' : '',
            });

            const hasGravity = loadLr > 0 || loadS > 0 || loadL > 0;
            checks.push({
                category: catE, item: '중력 활하중/적설하중',
                status: hasGravity ? 'pass' : 'warn',
                value: [loadLr>0?'Lr='+_dn(loadLr):'',loadS>0?'S='+_dn(loadS):'',loadL>0?'L='+_dn(loadL):''].filter(Boolean).join(', ')+' '+_rul('pressure') || '없음',
                criterion: '최소 하나의 중력 활하중 예상',
                note: !hasGravity ? '활하중/적설하중 없음 — 맞습니까?' : '',
            });

            // K3-6: 「풍하중 (W, 양력)」 은 지웠다 — 늘 통과(판정이 없다) — 양력 하중은 하중 분석 · 설계 항목이 본다

            // ════════════════════════════════════════
            // F. 하중 분석 결과 (Load Analysis Results)
            // ════════════════════════════════════════
            const catF = 'F. 하중 분석';

            checks.push({
                category: catF, item: '하중 분석 실행 여부',
                status: la ? 'pass' : 'fail',
                value: la ? '지배 조합: '+((la.governing||la.gravity||{}).combo||'N/A') : '미실행',
                criterion: '설계 전 하중 분석 필요',
                note: !la ? '②하중계산 탭에서 "하중 분석 실행"을 클릭하세요.' : '',
            });

            if (la && (la.governing?.locations || la.gravity?.locations || la.uplift?.locations)) {
                const locs = la.governing?.locations || la.gravity?.locations || la.uplift?.locations || [];
                const maxMu = Math.max(...locs.filter(l=>l.Mu!=null).map(l=>Math.abs(l.Mu)));
                checks.push({
                    category: catF, item: '최대 Mu',
                    status: maxMu > 0 ? 'pass' : 'warn',
                    value: _ruv(maxMu,'moment_ft')+' '+_rul('moment_ft'),
                    criterion: '지배 조합 기준 Mu > 0 이어야 함',
                    note: maxMu <= 0 ? '모멘트가 0 — 하중과 스팬을 확인하세요.' : '',
                });
                const hasVu = locs.some(l => l.Vu != null && l.Vu > 0);
                checks.push({
                    category: catF, item: '전단력 (Vu)',
                    status: hasVu ? 'pass' : 'warn',
                    value: hasVu ? '확인됨' : '일부 위치에서 누락',
                    criterion: '지점 및 임계 단면에서 Vu가 존재해야 함',
                    note: !hasVu ? '전단력 값이 없음 — 분석 결과를 확인하세요.' : '',
                });
            }

            if (la && la.auto_params) {
                const ap = la.auto_params;
                const negRegion = ap.negative_region_gov || ap.negative_region;
                if (negRegion) {
                    checks.push({
                        category: catF, item: '비지지 길이 Ly (부모멘트)',
                        status: negRegion.Ly_in > 0 ? 'pass' : 'warn',
                        value: _ruv(negRegion.Ly_in,'length')+' '+_rul('length'),
                        criterion: '부모멘트 구간에서 Ly > 0 (비지지 하부 플랜지)',
                        note: negRegion.Ly_in <= 0 ? '비지지 길이 0 — 부모멘트 구간이 완전 지지?' : '',
                    });
                    checks.push({
                        category: catF, item: '모멘트 구배 Cb',
                        status: negRegion.Cb >= 1.0 ? 'pass' : 'warn',
                        value: negRegion.Cb,
                        criterion: 'Cb ≥ 1.0 (AISI Eq. F2.1.1-2), 일반 1.0-2.3',
                        note: negRegion.Cb < 1.0 ? 'Cb < 1.0은 비정상 — 확인하세요.' : (negRegion.Cb > 2.5 ? '매우 높은 Cb — 모멘트 다이어그램 형태를 확인하세요.' : ''),
                    });
                }
                if (ap.uplift_R != null) {
                    checks.push({
                        category: catF, item: '양력 R 계수 (§I6.2.1)',
                        status: ap.uplift_R > 0 ? 'pass' : 'warn',
                        value: ap.uplift_R,
                        criterion: '조건 충족 시 R = 0.40-0.70 (§I6.2.1)',
                        note: ap.uplift_R_basis ? String(ap.uplift_R_basis) : '',
                    });
                } else if (la.uplift) {
                    // R 기본값은 없다 — §I6.2.1 조건 (a)–(o) 를 확인했을 때만 엔진이 R 을 준다.
                    var _i6 = ap.i621_check || {};
                    checks.push({
                        category: catF, item: '양력 R 계수 (§I6.2.1)',
                        status: 'warn',
                        value: '적용 안 함',
                        criterion: '§I6.2.1 조건 (a)–(o) 확인 시에만 R 법 적용',
                        note: (Array.isArray(_i6.reasons) && _i6.reasons.length > 0 ? _i6.reasons.map(_koText).join('; ') + ' — ' : '')
                            + '양력 구간은 R 법이 아닌 F2(LTB)로 검토되거나 판정 없음이 됩니다. 조건 확인 입력을 확인하세요.',
                    });
                }
            }

            // ── 정모멘트 구간 Lb/Cb 검증 ──
            if (la && la.auto_params && la.auto_params.positive_region) {
                var posR = la.auto_params.positive_region;
                if (!posR.braced) {
                    checks.push({
                        category: catF, item: '비지지 길이 Ly(+) (정모멘트)',
                        status: posR.Ly_in > 0 ? 'pass' : 'warn',
                        value: _ruv(posR.Ly_in, 'length') + ' ' + _rul('length'),
                        criterion: '데크 미구속 시 정모멘트 구간 Ly > 0 (변곡점 간 거리)',
                        note: '데크 없음 — 상부 플랜지가 비지지. Ly(+)를 확인하세요.',
                    });
                    checks.push({
                        category: catF, item: '모멘트 구배 Cb(+)',
                        status: posR.Cb >= 1.0 ? 'pass' : 'warn',
                        value: posR.Cb,
                        criterion: 'Cb ≥ 1.0 (AISI Eq. F2.1.1-2)',
                        note: '',
                    });
                } else {
                    // K3-6: 「정모멘트 구간 구속」 은 지웠다 — 늘 통과(데크 구속을 알리기만) — 보고서의 자동 결정 매개변수가 적는다
                }
            }

            // ── Lap 끝단 Mu 분리 검증 ──
            if (la && la.laps_per_support) {
                var _hasLaps2 = la.laps_per_support.some(function(lp) {
                    return lp && ((lp.left_ft || 0) > 0 || (lp.right_ft || 0) > 0);
                });
                if (_hasLaps2) {
                    var govLocs2 = (la.governing || la.gravity || {}).locations || [];
                    var lapEndMu = govLocs2.filter(function(l) { return (l.name||'').startsWith('Lap end') && l.Mu != null; });
                    var supMu = govLocs2.filter(function(l) { return l.Mu != null && l.Mu < 0 && !(l.name||'').startsWith('Lap end'); });
                    var hasLapEnd = lapEndMu.length > 0;
                    checks.push({
                        category: catF, item: 'Lap 끝단 Mu 추출',
                        status: hasLapEnd ? 'pass' : 'warn',
                        value: hasLapEnd
                            ? 'Lap end Mu=' + _ruv(Math.max(...lapEndMu.map(function(l){return Math.abs(l.Mu);})), 'moment_ft') + ' ' + _rul('moment_ft')
                            : '미추출',
                        criterion: 'Lap이 있으면 단일 단면 검토용 Mu는 Lap 끝단 부모멘트 사용 (AISI Ex. II-2A)',
                        note: hasLapEnd
                            ? '지점 최대 Mu=' + _ruv(supMu.length > 0 ? Math.max(...supMu.map(function(l){return Math.abs(l.Mu);})) : 0, 'moment_ft') + ' ' + _rul('moment_ft') + ' (Lap 2겹 검토용)'
                            : 'Lap end 위치가 모멘트도에서 추출되지 않았습니다.',
                    });
                }
            }

            // ── 처짐 검증 (건축 기준의 사용성 한계 — AISI S100 에는 수가 없다: THRESHOLDS.deflection_*) ──
            // K3-6(D13): 활하중 한계는 활하중만의 처짐(엔진 deflection_cases 의 L · Lr · S · R 단독)에, 전체하중 한계는 사용하중 합계
            // (엔진 deflection — D + 활하중)에. 전: 전체하중 한계를 적기만 하고 활하중 한계를 합계 처짐에 댔다.
            if (la && la.deflection && la.deflection.valid !== false && la.deflection.per_span) {
                const memberApp = document.getElementById('select-member-type');
                const mType = memberApp ? memberApp.value : '';
                const lim = mType === 'floor-joist' ? THRESHOLDS.deflection_floor : THRESHOLDS.deflection_roof;
                const liveCases = (Array.isArray(la.deflection_cases) ? la.deflection_cases : []).filter(c => c && ['L', 'Lr', 'S', 'R'].includes(c.case));
                la.deflection.per_span.forEach((ps, idx) => {
                    const tl = ps.L_over_delta;
                    const ll = liveCases.length ? Math.min(...liveCases.map(c => {
                        const p = (c.per_span || [])[idx];
                        return p && typeof p.L_over_delta === 'number' ? p.L_over_delta : Infinity;
                    })) : null;
                    const okTL = tl >= lim.TL, okLL = ll == null || ll >= lim.LL;
                    const near = (tl < lim.TL * THRESHOLDS.deflection_margin.value) || (ll != null && ll < lim.LL * THRESHOLDS.deflection_margin.value);
                    const ldTxt = (v) => (v === Infinity ? '∞' : v.toFixed(0));
                    checks.push({
                        category: catF, item: '처짐 — 스팬 '+(idx+1)+' (L/δ)',
                        status: okTL && okLL ? (near ? 'warn' : 'pass') : 'fail',
                        value: (ll != null ? '활하중 L/' + ldTxt(ll) + ', ' : '') + '전체 L/' + ldTxt(tl) + ' (δ=' + _ruv(ps.abs_delta_in,'length') + ' ' + _rul('length') + ')',
                        criterion: lim.label + ': 활하중 L/δ ≥ ' + lim.LL + ', 전체하중 L/δ ≥ ' + lim.TL + ' — ' + lim.source,
                        note: !okLL ? '활하중 처짐 한계 초과 (L/' + lim.LL + ').' : (!okTL ? '전체하중 처짐 한계 초과 (L/' + lim.TL + ').'
                            : (ll == null ? '활하중 단독 처짐이 없어(활하중 없음) 전체하중만 보았습니다.' : (near ? '한계에 근접 — 여유를 확인하세요.' : ''))),
                    });
                });
            } else if (la && la.deflection && la.deflection.valid === false) {
                checks.push({
                    category: catF, item: '처짐 검토',
                    status: 'fail',
                    value: '해석 실패',
                    criterion: 'IBC Table 1604.3 처짐 한계 검증 필요',
                    note: la.deflection.note || '처짐 해석 실패로 결과를 사용할 수 없습니다.',
                });
            } else if (la && !la.deflection) {
                checks.push({
                    category: catF, item: '처짐 검토',
                    status: 'warn',
                    value: '미계산',
                    criterion: 'IBC Table 1604.3 처짐 한계 검증 필요',
                    note: '단면 성질(Ixx)이 필요합니다. ①단면·재료 탭에서 단면을 생성하고 해석을 재실행하세요.',
                });
            }

            // ═══════��════════════════════════════════
            // G. 설계 결과 (Design Results)
            // ════════════════════════════════════════
            const catG = 'G. 설계 결과';

            checks.push({
                category: catG, item: '설계 검토 실행 여부',
                status: d ? 'pass' : 'fail',
                value: d ? d.member_type+' / '+d.design_method : '미실행',
                criterion: '설계 검토가 완료되어야 함',
                note: !d ? '③좌굴해석·부재설계 탭에서 "설계 검토 실행"을 클릭하세요.' : '',
            });

            // 종합 판정 (엔진 pass 3상태) — 판정 없음은 'warn' 이며 평가하지 못한 항목을 적는다.
            if (d && !d.error) {
                const _dv = _v3(d);
                const _dne = _notEvalList(d).concat(Array.isArray(d.purlin_not_evaluated) ? d.purlin_not_evaluated : []);
                checks.push({
                    category: catG, item: '종합 판정 (엔진)',
                    status: _statusFromVerdict(_dv, d.utilization),
                    value: _dv.label + (d.governing_check ? ' — 지배: ' + d.governing_check : ''),
                    criterion: '해당하는 한계상태를 모두 평가하고 모두 만족',
                    note: _dv.state === 'NOT_CHECKED'
                        ? ('평가하지 못한 항목: ' + (_dne.length > 0 ? _dne.join('; ') : '(목록 없음 — 소요값 또는 입력 확인)'))
                        : (_dv.state === 'FAIL' ? '불합격 — 지배 검토를 확인하세요.' : ''),
                });
            }

            if (d && !d.error) {
                // Mn 구성요소 검토
                if (d.member_type === 'flexure') {
                    // Inelastic Reserve 적용 여부 확인
                    const irApplied = d.steps && d.steps.some(s => s.equation && s.equation.includes('F2.4.2'));
                    const mneLimit = irApplied ? (d.Mp || d.My * 1.5) : d.My;
                {
                    // K3-6(D1): 엔진의 member.flexure.global 판정이 이긴다(소요가 없으면 미평가 → 주의, 감소는 「주의」 가 아니다). 엔진 항목이 없는 옛 결과만 옛 규칙
                    const _ec = _engineCheck(d, 'member.flexure.global');
                    const _es = _ec ? _engineStatus(_ec) : undefined;
                    if (_es !== null) {
                        checks.push({
                            category: catG, item: 'Mne vs My',
                            status: _es !== undefined ? _es : (d.Mne != null && d.My != null ? (d.Mne <= mneLimit * 1.01 ? 'pass' : 'warn') : 'fail'),
                            value: 'Mne='+_rv(d.Mne)+', My='+_rv(d.My) + (irApplied ? ', Mp='+_rv(d.Mp) : ''),
                            criterion: irApplied ? '§F2.4.2 Inelastic Reserve: My ≤ Mne ≤ Mp' : '§F2 전체좌굴(엔진 판정)',
                            note: _ec ? _engineNote(_ec) : '',
                        });
                    }
                }

                    // §F2.4.2 Inelastic Reserve Strength 검증
                    const hasZf = p && (p.Zx > 0 || p.Zf > 0);
                    checks.push({
                        category: catG, item: '§F2.4.2 Inelastic Reserve',
                        status: irApplied ? 'pass' : (hasZf ? 'warn' : 'warn'),
                        value: irApplied
                            ? 'Mne='+_rv(d.Mne)+' > My='+_rv(d.My)+' (+'+(((d.Mne/d.My)-1)*100).toFixed(1)+'%)'
                            : '미적용',
                        criterion: '조건: Mcre > 2.78My, 횡좌굴 억제 (deck braced), Zf > 0',
                        note: !irApplied
                            ? (hasZf
                                ? 'Zf(소성단면계수) 존재 — use_inelastic_reserve 옵션 활성화 시 Mne 최대 25% 증가 가능. Mcre > 2.78My 조건을 확인하세요.'
                                : 'Zf(소성단면계수) 미계산 — 단면 성질을 재계산하세요.')
                            : '',
                    });

                    // R-factor (§I6.2.1) 양력 감소계수 검증
                    // V4-23: 자동 계산 모드는 퍼린 결과의 uplift_R(적격 구간에 적용)을 본다 — 직접 입력 체크박스가 아니라.
                    const _purlinR = d.purlin_mode && Array.isArray(d.purlin_regions)
                        ? (d.purlin_regions.find(rg => rg && rg.R_uplift != null) || {}).R_uplift : undefined;
                    const rApplied = (d.R_uplift != null && d.R_uplift > 0) || (_purlinR != null && _purlinR > 0);
                    const _rShown = d.R_uplift > 0 ? d.R_uplift : _purlinR;
                    checks.push({
                        category: catG, item: '§I6.2.1 R-factor (양력)',
                        // R 미적용 자체는 오류가 아니다. 퍼린 양력 구간이 있는데 R 이 없으면 주의.
                        status: rApplied ? 'pass'
                            : ((Array.isArray(d.purlin_regions) && d.purlin_regions.some(rg => rg && String(rg.kind || '').indexOf('uplift') === 0)) ? 'warn' : 'pass'),
                        value: rApplied ? 'R='+_rShown : '미적용',
                        criterion: 'Through-fastened 패널 + 양력 시 R=0.40~0.70 적용 (§I6.2.1)',
                        note: rApplied
                            ? 'R 감소계수 적용됨 — Mn=R×Mnfo로 양력 강도 결정.'
                            : '양력 하중이 없거나 R-factor 조건 미충족. 양력 설계 시 R 값을 입력하세요.',
                    });
                    // §A3.3.2 Cold Work of Forming 검증
                    const cwApplied = d.cold_work && d.cold_work.applicable;
                    const cwRequested = d.use_cold_work === true;
                    const irActive = d.use_inelastic_reserve === true;
                    const cwBlockedByIR = cwRequested && irActive;
                    let cwStatus = 'pass';
                    let cwValue = '';
                    let cwNote = '';
                    if (cwBlockedByIR && !cwApplied) {
                        cwStatus = 'warn';
                        cwValue = '비활성 — Inelastic Reserve와 동시 적용 불가';
                        cwNote = '§A3.3.2 적용 범위에서 §F2.4(Inelastic Reserve)가 명시적으로 제외됩니다. IR을 해제하면 Cold Work 적용 가능.';
                    } else if (cwApplied) {
                        if (irActive) {
                            cwStatus = 'warn';
                            cwValue = 'Fya=' + _ruv(d.Fy_used,'stress') + ' ' + _rul('stress') + ' (+' + d.cold_work.increase_pct + '%) — IR에는 원래 Fy 사용';
                            cwNote = '⚠ §A3.3.2: Cold Work(Fya)는 DSM 국부/뒤틀림에 적용되지만, Inelastic Reserve(Mne)에는 Fy_original=' + _ruv(d.Fy_original,'stress') + ' ' + _rul('stress') + ' 사용.';
                        } else {
                            cwStatus = 'pass';
                            cwValue = 'Fya=' + _ruv(d.Fy_used,'stress') + ' ' + _rul('stress') + ' (+' + d.cold_work.increase_pct + '%)';
                            cwNote = 'Fya=' + _rv(d.Fy_used) + ' > Fy=' + _rv(d.Fy_original) + ' — 코너부 냉간가공 효과 반영됨.';
                        }
                    } else if (cwRequested) {
                        // K3-6(D2): 선택 조항을 쓰지 못한 것은 「실패」 가 아니다 — 주의, 까닭은 엔진이 적은 것(없으면 조건)
                        const _cwW = _warnList(d).find(w => /A3\.3\.2/.test(String(w)));
                        cwStatus = 'warn';
                        cwValue = '적용 안 됨';
                        cwNote = _cwW ? String(_cwW) : '§A3.3.2 조건(Fu/Fy ≥ 1.2, R/t ≤ 7, 각도 ≤ 120°)을 확인하세요.';
                    } else {
                        cwValue = '미적용 (Fy=' + _ruv(d.Fy_original,'stress') + ' ' + _rul('stress') + ')';
                        cwNote = 'Cold Work 미적용. 고급 옵션에서 체크박스를 켜면 활성화됩니다.';
                    }
                    checks.push({
                        category: catG, item: '§A3.3.2 Cold Work (냉간가공)',
                        status: cwStatus,
                        value: cwValue,
                        criterion: '§A3.3.2: Fu/Fy≥1.2, R/t≤7, 각도≤120°. §F2.4(Inelastic Reserve) 제외.',
                        note: cwNote,
                    });

                    // §A3.3.2 + §F2.4.2 배타 관계 검증
                    if (cwRequested && irActive) {
                        checks.push({
                            category: catG, item: '§A3.3.2 ↔ §F2.4.2 배타 관계',
                            status: 'warn',
                            value: 'Cold Work + Inelastic Reserve 동시 선택됨',
                            criterion: '§A3.3.2 적용 범위에서 §F2.4(Inelastic Reserve)가 명시적으로 제외됨',
                            note: cwApplied
                                ? 'Cold Work(Fya)는 Mnl/Mnd에만 적용, Mne(IR)에는 원래 Fy=' + _ruv(d.Fy_original,'stress') + ' ' + _rul('stress') + ' 사용. 두 옵션 중 하나만 사용을 권장.'
                                : 'Cold Work 조건 미충족으로 Fya 미적용. IR만 활성 상태.',
                        });
                    }

                {
                    // K3-6(D1): 엔진의 member.flexure.local 판정이 이긴다(소요가 없으면 미평가 → 주의, 감소는 「주의」 가 아니다). 엔진 항목이 없는 옛 결과만 옛 규칙
                    const _ec = _engineCheck(d, 'member.flexure.local');
                    const _es = _ec ? _engineStatus(_ec) : undefined;
                    if (_es !== null) {
                        checks.push({
                            category: catG, item: 'Mnl vs Mne (국부좌굴 감소)',
                            status: _es !== undefined ? _es : (d.Mnl != null ? 'pass' : 'fail'),
                            value: 'Mnl='+_rv(d.Mnl)+', Mne='+_rv(d.Mne),
                            criterion: '§F3.2 국부좌굴(엔진 판정) — Mnl < Mne 는 감소일 뿐 결함이 아니다',
                            note: _ec ? _engineNote(_ec) : '',
                        });
                    }
                }
                {
                    // K3-6(D1): 엔진의 member.flexure.distortional 판정이 이긴다(소요가 없으면 미평가 → 주의, 감소는 「주의」 가 아니다). 엔진 항목이 없는 옛 결과만 옛 규칙
                    const _ec = _engineCheck(d, 'member.flexure.distortional');
                    const _es = _ec ? _engineStatus(_ec) : undefined;
                    if (_es !== null) {
                        checks.push({
                            category: catG, item: 'Mnd vs My (뒤틀림좌굴 감소)',
                            status: _es !== undefined ? _es : (d.Mnd != null ? 'pass' : 'fail'),
                            value: 'Mnd='+_rv(d.Mnd)+', My='+_rv(d.My),
                            criterion: '§F4 뒤틀림좌굴(엔진 판정) — Mnd < My 는 감소일 뿐 결함이 아니다',
                            note: _ec ? _engineNote(_ec) : '',
                        });
                    }
                }
                    // K3-6: 「모든 Mn 동일 (잠재적 문제)」 은 지웠다 — λℓ 를 My 로 다시 셈(D16) — 엔진의 F2 · F3 · F4 판정이 위 항목에 있다

                    // 정모멘트 구간 결과 검증
                    if (d.positive_region) {
                        var prV = d.positive_region;
                        checks.push({
                            category: catG, item: '정모멘트 φMn(+)',
                            status: prV.phi_Mn > 0 ? 'pass' : 'warn',
                            value: _ruv(prV.phi_Mn, 'moment') + ' ' + _rul('moment') + ' (Lb=' + _ruv(prV.Lb, 'length') + ', Cb=' + prV.Cb + ')',
                            criterion: '정모멘트 구간 설계강도 > 0',
                            note: prV.Mn < d.Mn ? '정모멘트 구간 Mn(' + _rv(prV.Mn) + ') < 부모멘트 Mn(' + _rv(d.Mn) + ') — 정모멘트가 지배할 수 있음' : '',
                        });
                        // K3-6: 「정모멘트 LTB」 은 지웠다 — 정모멘트 구간의 판정은 엔진의 member.flexure.positive_region(「이용률 — 정모멘트」)
                    }
                }

                if (d.member_type === 'compression') {
                {
                    // K3-6(D1): 엔진의 member.compression.local 판정이 이긴다(소요가 없으면 미평가 → 주의, 감소는 「주의」 가 아니다). 엔진 항목이 없는 옛 결과만 옛 규칙
                    const _ec = _engineCheck(d, 'member.compression.local');
                    const _es = _ec ? _engineStatus(_ec) : undefined;
                    if (_es !== null) {
                        checks.push({
                            category: catG, item: 'Pnl vs Pne (국부좌굴 감소)',
                            status: _es !== undefined ? _es : (d.Pnl != null ? 'pass' : 'fail'),
                            value: 'Pnl='+_rv(d.Pnl)+', Pne='+_rv(d.Pne),
                            criterion: '§E3.2 국부좌굴(엔진 판정)',
                            note: _ec ? _engineNote(_ec) : '',
                        });
                    }
                }
                {
                    // K3-6(D1): 엔진의 member.compression.distortional 판정이 이긴다(소요가 없으면 미평가 → 주의, 감소는 「주의」 가 아니다). 엔진 항목이 없는 옛 결과만 옛 규칙
                    const _ec = _engineCheck(d, 'member.compression.distortional');
                    const _es = _ec ? _engineStatus(_ec) : undefined;
                    if (_es !== null) {
                        checks.push({
                            category: catG, item: 'Pnd vs Py (뒤틀림좌굴 감소)',
                            status: _es !== undefined ? _es : (d.Pnd != null ? 'pass' : 'fail'),
                            value: 'Pnd='+_rv(d.Pnd)+', Py='+_rv(d.Py),
                            criterion: '§E4 뒤틀림좌굴(엔진 판정)',
                            note: _ec ? _engineNote(_ec) : '',
                        });
                    }
                }
                }

                // ── 이용률: 부모멘트 ──
                if (d.utilization != null && d.member_type === 'flexure') {
                    var _negUtil = d.utilization;
                    // K3-6(D15): 퍼린 묶음이면 지배 부모멘트 구간이 쓴 Ly · Cb(칸의 Lb · Cb 가 아니다)
                    var _negReg = d.purlin_mode && d.design_negative && d.design_negative.region ? d.design_negative.region : null;
                    var _negLb2 = _negReg ? Number(_negReg.Ly_in) : fromDisplay(getNum('design-Lb', 0), 'length');
                    var _negCb2 = _negReg ? Number(_negReg.Cb) : getNum('design-Cb', 1.0);
                    checks.push({
                        category: catG, item: '이용률 — 부모멘트 (-M)',
                        status: _statusFromVerdict(_checkVerdict(d, 'F flexure', _negUtil), _negUtil),
                        value: (_negUtil*100).toFixed(1)+'%',
                        criterion: 'Mu(-) / φMn(-) ≤ 1.0',
                        note: _negUtil > 1.0 ? '부모멘트 구간 과응력 — 단면을 키우거나 Lb(-)를 줄이세요.' : '',
                    });
                    checks.push({
                        category: catG, item: 'Lb(-) / Cb(-) (부모멘트)',
                        status: _negLb2 > 0 ? 'pass' : 'warn',
                        value: (_negReg ? (_negReg.label || _negReg.id) + ': ' : '') + 'Lb(-)=' + (isFinite(_negLb2) ? fmtVal(_negLb2, 'length') + ' ' + unitLabel('length') : '—') + ', Cb(-)=' + (isFinite(_negCb2) ? _negCb2 : '—'),
                        criterion: '부모멘트 구간: 변곡점~Lap끝 또는 지점까지 비지지 길이',
                        note: _negLb2 <= 0 ? 'Lb=0 → 완전 구속 가정. 실제 조건을 확인하세요.' : (_negCb2 > 2.3 ? 'Cb > 2.3 — 매우 높은 값. 모멘트 다이어그램을 확인하세요.' : ''),
                    });
                } else if (d.utilization != null) {
                    // 계약 §6.4: 주 소요를 주지 않았으면 이용률은 평가한 것 가운데의 비일 뿐(utilization_valid: false) — 판정 없음으로, 그 까닭과
                    const _uInvalid = d.utilization_valid === false;
                    checks.push({
                        category: catG, item: '이용률 (DCR)',
                        status: _uInvalid ? (d.pass === false ? 'fail' : 'warn') : _statusFromVerdict(_v3(d), d.utilization),
                        value: _uInvalid ? (d.pass === false ? (d.utilization*100).toFixed(1)+'% — '+_v3(d).short+' (소요 일부 없음)' : '판정 없음 — 주 소요를 주지 않음')
                            : (d.utilization*100).toFixed(1)+'% — '+_v3(d).short,
                        criterion: 'DCR ≤ 100%',
                        note: d.utilization > 1.0 ? '과응력 — 설계 요구사항 미충족.' : '',
                    });
                }

                // ── 이용률: 정모멘트 ──
                // V9a-07: 퍼린 모드는 정모멘트 구간을 퍼린 설계가 구간마다 평가했다 — 지배 구간의 positive_region 이 비었다고
                // 「Mu(+) 미입력」 이라 하지 않는다(그 판정은 퍼린 구간 결과 · Lb(+)/Cb(+) 항목에)
                if (d.positive_region && d.member_type === 'flexure') {
                    var _posR = d.positive_region;
                    if (!(d.purlin_mode === true && _posR.utilization == null)) checks.push({
                        category: catG, item: '이용률 — 정모멘트 (+M)',
                        status: _posR.utilization != null ? _statusFromVerdict(_v3(_posR), _posR.utilization) : 'warn',
                        value: _posR.utilization != null ? (_posR.utilization*100).toFixed(1)+'%' : 'Mu(+) 미입력',
                        criterion: 'Mu(+) / φMn(+) ≤ 1.0',
                        note: _posR.utilization != null && _posR.utilization > 1.0
                            ? '정모멘트 구간 과응력 — Lb(+)를 줄이거나 가새를 추가하세요.'
                            : (_posR.utilization == null ? '설계탭에서 Mu(+) 값을 입력하세요.' : ''),
                    });
                    {
                        const _pc = _engineCheck(d, 'member.flexure.positive_region');
                        const _ps = _pc ? _engineStatus(_pc) : undefined;
                        checks.push({
                            category: catG, item: 'Lb(+) / Cb(+) (정모멘트)',
                            // K3-6: 2.78Fy 를 화면이 다시 견주지 않는다 — 엔진의 정모멘트 구간 판정(D5: 끝없는 Fcre 는 ∞)
                            status: _ps !== undefined && _ps !== null ? _ps : 'pass',
                            value: 'Lb(+)=' + fmtVal(_posR.Lb, 'length') + ' ' + unitLabel('length') + ', Cb(+)=' + _posR.Cb + ', Fcre(+)=' + _fcreText(_posR),
                            criterion: '정모멘트 구간: 데크 구속 시 Lb=0, 미구속 시 변곡점 간 거리',
                            note: _posR.Lb === 0 ? '데크에 의한 연속 구속 — LTB 없음.' : (_pc ? _engineNote(_pc) : ''),
                        });
                    }
                }

                // K3-6(D6): 「저항계수 (φ)」 는 지웠다 — 늘 통과하는 상수였다. 엔진이 쓴 φ · Ω 는 보고서의 계산 절(design_checks.factor)이 적는다

                // 조합 검토
                if (d.interaction) {
                    checks.push({
                        category: catG, item: '조합 검토 (§H1.2)',
                        status: _statusFromVerdict(_v3(d.interaction), d.interaction.total),
                        value: _rv(d.interaction.total,4)+' ≤ 1.0 — '+_v3(d.interaction).short,
                        criterion: 'P/Pa + Mx/Max + My/May ≤ 1.0',
                        note: _v3(d.interaction).state === 'FAIL' ? '조합 검토 실패 — 하중을 줄이거나 단면을 키우세요.'
                            : (_v3(d.interaction).state === 'NOT_CHECKED' ? '조합 검토 판정 없음 — 구성 강도 중 평가하지 못한 것이 있습니다.' : ''),
                    });
                }

                // 설계 엔진의 DSM 경고
                if (d.dsm_warnings && d.dsm_warnings.length > 0) {
                    d.dsm_warnings.map(_koText).forEach((w, i) => {
                        checks.push({
                            category: catG, item: 'DSM 경고 #'+(i+1),
                            status: 'warn',
                            value: w,
                            criterion: 'Table B4.1-1 적용 한계',
                            note: '단면이 DSM 사전검증 한계 밖일 수 있습니다.',
                        });
                    });
                }

                // 설계 결과 warnings (Mcrd fallback, R-factor 등 — 정모멘트 NG 중복 제외)
                if (d.warnings && d.warnings.length > 0) {
                    _warnList(d).forEach((w, i) => {
                        // 정모멘트 NG 경고는 이용률 항목에서 이미 표시하므로 제외
                        if (w.includes('정모멘트 구간 NG')) return;
                        const isFallback = w.includes('§2.3.3.3') || w.includes('§2.3.1.3');
                        checks.push({
                            category: catG, item: isFallback ? '뒤틀림좌굴 해석적 Fallback' : '설계 경고 #'+(i+1),
                            status: 'warn',  // 엔진 경고는 값·판정에 영향이 있을 수 있으므로 통과로 세지 않는다
                            value: w,
                            criterion: isFallback ? 'FSM 미검출 시 Appendix 2 해석적 공식으로 Fcrd 자동 계산' : '설계 엔진 경고',
                            note: isFallback ? '§2.3.3.3 해석적 공식이 적용되었습니다.' : '',
                        });
                    });
                }

                // dsm_warning (DSM 추출 경고)
                if (d.dsm_warning) {
                    checks.push({
                        category: catG, item: 'DSM 추출 경고',
                        status: 'warn',
                        value: d.dsm_warning,
                        criterion: 'DSM 값이 올바르게 추출되어야 함',
                        note: '',
                    });
                }
            }

            // ════════════════════════════════════════
            // G2. Lap 접합부 (연속 경간)
            // ════════════════════════════════════════
            if (la && la.laps_per_support) {
                var _hasLaps3 = la.laps_per_support.some(function(lp) {
                    return lp && ((lp.left_ft || 0) > 0 || (lp.right_ft || 0) > 0);
                });
                if (_hasLaps3 && d && d.member_type === 'flexure') {
                    var catG2 = 'G2. Lap 접합부';

                    // Lap 구간 휨강도 (2겹 합산)
                    var lapDesign = d.design_lap || null;
                    if (lapDesign) {
                        // V9a-07: 퍼린의 랩 구간 결과는 **한 부재**의 설계강도(엔진이 한 부재로 이름 붙인다) — 2겹 합산은 랩 접합 검토(아래 「Lap 휨강도 DCR」)
                        checks.push({
                            category: catG2, item: 'Lap 구간 휨강도 (§F3, 한 부재)',
                            status: _statusFromVerdict(_v3(lapDesign), lapDesign.utilization),
                            value: (lapDesign.design_strength != null ? (_ruv(lapDesign.design_strength, 'moment') + ' ' + _rul('moment')) : '미계산') + ' — ' + _v3(lapDesign).short,
                            criterion: '퍼린 랩 구간의 한 부재 검토(엔진의 구간 판정) — 2겹 합산 휨은 Lap 접합부 검토',
                            note: lapDesign.utilization != null ? 'DCR=' + lapDesign.utilization.toFixed(3) : '',
                        });
                    }

                    // Lap 길이 ≥ 1.5d
                    la.laps_per_support.forEach(function(lp, idx) {
                        if (!lp || ((lp.left_ft || 0) <= 0 && (lp.right_ft || 0) <= 0)) return;
                        // V4-25: 한쪽이 0 이면 그쪽이 1.5d 를 못 채운다(전: || 999 로 다른 쪽만 봄). d 는 단면 깊이 —
                        // 칸이 비면 판정하지 않는다(전: 비면 100 mm 기본).
                        var lapIn = Math.min(lp.left_ft || 0, lp.right_ft || 0) * 12;
                        var Hval = _optNum('tpl-H', 'length');
                        var minLap = Hval !== undefined ? 1.5 * Hval : NaN;
                        var lapOK = isFinite(minLap) ? lapIn >= minLap : null;
                        checks.push({
                            category: catG2, item: 'Lap 길이 (지점 ' + (idx + 1) + ') §I6.2.1(g)',
                            status: lapOK === true ? 'pass' : (lapOK === false ? 'fail' : 'warn'),
                            value: lapOK === null ? '단면 깊이 H 가 비어 판정 없음'
                                : _ruv(lapIn, 'length') + ' ' + _rul('length') + (lapOK ? ' ≥ ' : ' < ') + '1.5d=' + _ruv(minLap, 'length'),
                            criterion: '양쪽 Lap ≥ 1.5d (§I6.2.1(g)) — 부족하면 R 계수법 · J3 슬롯 예외를 쓸 수 없음',
                            note: lapOK === false ? 'Lap 길이 부족 — 양쪽 각각 최소 ' + _ruv(minLap, 'length') + ' ' + _rul('length') + ' 필요' : '',
                        });
                    });

                    // 접합부 패스너 설계 실행 여부 + 결과
                    if (_lastLapResult && !_lastLapResult.error) {
                        var _lr = _lastLapResult;
                        // 패스너 전단 DCR
                        // K3-6(D4): 패스너 무리의 판정은 엔진의 lap.fastener_group(전: 랩 전체가 통과일 때만 「평가함」 으로 보아 주의)
                        // 엔진 733c18e: 맨 위 utilization 은 랩 강도 검토의 최대 비 — 패스너 무리의 비는 fastener_utilization(옛 결과는 utilization)
                        var _lrFast = typeof _lr.fastener_utilization === 'number' ? _lr.fastener_utilization : (_lr.governing_check === undefined ? _lr.utilization : null);
                        const _fg = _engineCheck(_lr, 'lap.fastener_group');
                        checks.push({
                            category: catG2, item: 'Lap 패스너 전단 (DCR)',
                            status: _fg ? (_engineStatus(_fg) || 'pass') === 'pass' ? _statusFromVerdict(_v3(true), _lrFast) : _engineStatus(_fg)
                                : (_lrFast != null ? _statusFromVerdict(_ratioVerdict(_lrFast, _lr.pass === true), _lrFast) : 'warn'),
                            value: _lrFast != null
                                ? 'DCR=' + _lrFast.toFixed(3) + ' (V=' + _ruv(_lr.V_transfer, 'force') + ' / Cap=' + _ruv(_lr.capacity, 'force') + ' ' + _rul('force') + ')'
                                : '미계산',
                            criterion: '패스너 전단 DCR ≤ 1.0',
                            note: _lrFast > 1.0 ? '패스너 용량 부족 — 패스너 수 또는 사양을 변경하세요.' : '',
                        });
                        // Lap 휨강도 DCR
                        var _lrGov = (_lr.flexure_dcr_governing != null) ? _lr.flexure_dcr_governing : _lr.flexure_dcr;
                        // V9a-03: 이 항목의 판정은 엔진 검토 항목(국부 · 뒤틀림 · H2)의 판정을 따른다 — flexure_checked 하나로 「통과」 를 짓지 않는다.
                        // 하나라도 불합격이면 실패, 하나라도 미평가면 주의(판정 없음), 판정이 있는 것이 모두 통과일 때만 통과
                        const _lfx = ['lap.flexure.local', 'lap.flexure.distortional', 'lap.bending_shear'].map((id) => _engineCheck(_lr, id)).filter(Boolean);
                        const _lfxSt = _lfx.map(_engineStatus).filter((s) => s !== null);
                        if (_lrGov != null || _lfxSt.length) {
                            const _st = _lfxSt.includes('fail') ? 'fail' : _lfxSt.includes('warn') ? 'warn'
                                : _lfxSt.length ? _statusFromVerdict(_v3(true), _lrGov) : _statusFromVerdict(_ratioVerdict(_lrGov, false), _lrGov);
                            const _ne = _lfx.filter((c) => _engineStatus(c) === 'warn');
                            checks.push({
                                category: catG2, item: 'Lap 휨강도 DCR (2겹 §F3/F4/H2)',
                                status: _st,
                                value: _lrGov != null ? 'DCR=' + _lrGov.toFixed(3) + ' (φMn=' + _ruv(_lr.phi_Mn_lap, 'moment') + ' ' + _rul('moment') + ')' + (_st === 'warn' ? ' — 판정 없음' : '') : '판정 없음',
                                criterion: '2겹 합산 휨강도 DCR ≤ 1.0',
                                note: _st === 'fail' ? 'Lap 구간 휨강도 부족 — 단면을 키우거나 Fy를 높이세요.'
                                    : _ne.length ? '판정 없음 — ' + _ne.map((c) => _engineNote(c) || c.id).join('; ') : '',
                            });
                        }
                        // 종합
                        checks.push({
                            category: catG2, item: 'Lap 접합부 종합 판정',
                            status: _statusFromVerdict(_v3(_lr), null),
                            value: _v3(_lr).label,
                            criterion: 'Lap 길이 + 패스너 전단 + 휨강도 모두 OK',
                            note: _v3(_lr).state === 'PASS' ? ''
                                : (_v3(_lr).state === 'FAIL' ? '④접합부 탭에서 상세 결과를 확인하세요.'
                                    : '판정 없음 — ' + (_notEvalList(_lr).join('; ') || '평가하지 못한 한계상태가 있습니다 (④접합부 탭 확인)')),
                        });
                    } else {
                        // Lap 접합부 설계 미실행
                        checks.push({
                            category: catG2, item: 'Lap 접합부 설계 실행 여부',
                            status: 'fail',
                            value: '미실행',
                            criterion: 'Lap이 있으면 접합부 설계를 실행하여 패스너/휨강도를 검증해야 함',
                            note: '④접합부 탭 → "Lap 접합부 설계" 버튼을 클릭하세요. 하중분석 후 Mu/Vu가 자동 입력됩니다.',
                        });
                    }
                }
            }

            // ════════════════════════════════════════
            // H. 설계 일관성 (Consistency)
            // ════════════════════════════════════════
            const catH = 'H. 일관성';

            // Fy 일치 여부 확인
            // K3-6(D6): 화면의 두 거울 칸(① Fy · 설계 Fy)을 견주어 늘 통과였다 — 좌굴 해석의 기준응력(모델 loadFy, AI 가 정했을 수 있다)과 설계 Fy
            const _refFy = model && Number(model.loadFy) > 0 ? Number(model.loadFy) : null;
            const _fyUs = fromDisplay(fy, 'stress');
            const _fyOk = _refFy == null || !(analysisResult && analysisResult.curve) || Math.abs(_refFy - _fyUs) <= 1e-6 * Math.max(1, _fyUs);
            checks.push({
                category: catH, item: 'Fy 일관성 (해석 vs 설계)',
                status: _fyOk ? 'pass' : 'warn',
                value: '해석 기준응력 ' + (_refFy == null ? '—' : _ruv(_refFy,'stress')) + ', 설계 Fy ' + _ruv(_fyUs,'stress') + ' ' + _rul('stress'),
                criterion: '좌굴 해석의 기준응력과 설계 Fy 가 같으면 DSM 값을 그대로 쓴다',
                note: _fyOk ? '' : '좌굴 해석이 다른 기준응력으로 돌았습니다(모델 loadFy) — 엔진이 DSM 값을 설계 Fy 로 다시 맞추는지 설계 결과의 경고를 확인하거나, 설계 Fy 로 해석을 다시 돌리세요.',
            });

            // 현재 단면으로 해석 여부 확인
            if (model && model.node && analysisResult) {
                // K3-6(D6): 늘 통과였다 — 호스트가 아는 해석의 최신성(모델 서명)으로
                checks.push({
                    category: catH, item: '해석 최신성',
                    status: env.analysisCurrent === false ? 'fail' : 'pass',
                    value: env.analysisCurrent === false ? '해석 뒤 모델이 바뀜' : '현재 모델의 해석',
                    criterion: '해석이 현재 단면 · 재료 · 해석 조건과 일치해야 함',
                    note: env.analysisCurrent === false ? '해석 뒤 단면 · 재료 · 경계조건 · 길이가 바뀌었습니다 — 해석을 다시 실행하세요.' : '',
                });
            }

            return checks;
        }

        function renderValidationDashboard(checks) {
            const groups = {};
            checks.forEach(c => {
                if (!groups[c.category]) groups[c.category] = [];
                groups[c.category].push(c);
            });

            const icons = { pass: '✓', warn: '!', fail: '✗' };
            const colors = { pass: '#4caf50', warn: '#ffab00', fail: '#ff5252' };
            const bgColors = { pass: 'rgba(76,175,80,0.08)', warn: 'rgba(255,171,0,0.08)', fail: 'rgba(255,82,82,0.1)' };

            let h = '';
            for (const [cat, items] of Object.entries(groups)) {
                const catPass = items.filter(i => i.status === 'pass').length;
                const catWarn = items.filter(i => i.status === 'warn').length;
                const catFail = items.filter(i => i.status === 'fail').length;
                const catColor = catFail > 0 ? colors.fail : (catWarn > 0 ? colors.warn : colors.pass);

                h += '<div style="margin-bottom:12px">';
                h += '<div style="font-weight:700;font-size:12px;padding:4px 8px;border-left:3px solid '+catColor+';background:'+bgColors[catFail>0?'fail':(catWarn>0?'warn':'pass')]+';border-radius:0 4px 4px 0">';
                h += _esc(cat);
                h += '<span style="float:right;font-size:11px;font-weight:400">';
                if (catPass) h += '<span style="color:'+colors.pass+'">'+catPass+' 통과</span> ';
                if (catWarn) h += '<span style="color:'+colors.warn+'">'+catWarn+' 주의</span> ';
                if (catFail) h += '<span style="color:'+colors.fail+'">'+catFail+' 실패</span>';
                h += '</span></div>';

                h += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-top:2px">';
                h += '<tr style="background:var(--vscode-editor-selectionBackground)"><th style="width:20px"></th><th>검토 항목</th><th>값</th><th>기준</th></tr>';
                items.forEach(c => {
                    const bg = c.status === 'fail' ? 'background:rgba(255,82,82,0.06)' : (c.status === 'warn' ? 'background:rgba(255,171,0,0.04)' : '');
                    h += '<tr style="'+bg+'">';
                    h += '<td style="text-align:center;font-weight:700;color:'+colors[c.status]+'">'+icons[c.status]+'</td>';
                    // K3-6(D12): 엔진 · 상태의 글을 그대로 넣지 않는다
                    h += '<td>'+_esc(c.item)+'</td>';
                    h += '<td style="font-family:monospace;font-size:10px">'+_esc(c.value)+'</td>';
                    h += '<td style="font-size:10px;color:var(--vscode-descriptionForeground)">'+_esc(c.criterion)+'</td>';
                    h += '</tr>';
                    if (c.note) {
                        h += '<tr style="'+bg+'"><td></td><td colspan="3" style="font-size:10px;color:'+colors[c.status]+';padding:0 6px 4px;font-style:italic">→ '+_esc(c.note)+'</td></tr>';
                    }
                });
                h += '</table></div>';
            }
            return h;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // K3-7: 보고서 데이터(ReportDoc) — 이 묶음은 수를 만들지 않는다. 값은 엔진 결과 · 모델 · 검토 상태(칸의 정확한 US 값)
        // 그대로이고 quantity 가 붙는다. SI 는 호스트가 src/mcp/siUnits.ts reportDocToSI 로, 그리기는 reportRender.js 로.
        // ═══════════════════════════════════════════════════════════════════════
        /** 보고서의 날짜 — 고정 폭(YYYY-MM-DD HH:MM, 이 PC 의 시각). 로캘 글(오전/오후, 자리 수)이 크기 · 쪽을 바꾸지 않게 */
        function _reportDate() {
            const d = new Date(), p = (n) => String(n).padStart(2, '0');
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        }
        const LOAD_MEMBERS = ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'];
        /** 값 하나(US): 수가 아니면 null, ∞ 는 unbounded */
        function RQ(v, quantity, extra) {
            const n = typeof v === 'number' ? v : (v === null || v === undefined || v === '' ? NaN : Number(v));
            const o = { value: isFinite(n) ? n : null, quantity };
            if (n === Infinity) { o.unbounded = true; }
            return extra ? Object.assign(o, extra) : o;
        }
        const RS = (values, quantity) => ({ values: (values || []).map(Number), quantity });
        const _selText = (id) => {
            const el = document.getElementById(id);
            return el && el.options && el.selectedIndex >= 0 && el.options[el.selectedIndex] ? String(el.options[el.selectedIndex].text || '') : '';
        };
        const _selVal = (id) => { const el = document.getElementById(id); return el ? String(el.value || '') : ''; };
        const _exact = (id, ut) => { const v = _optNum(id, ut); return v === undefined ? null : v; };
        const _exactEl = (el, ut) => {
            if (!el) { return null; }
            const ex = DS.exactOf(el);
            if (ex !== undefined) { return ex; }
            const v = parseFloat(String(el.value || ''));
            return isFinite(v) ? fromDisplay(v, ut) : null;
        };
        const _verdictKey = (r) => {
            const v = _v3(r);
            return v.state === 'PASS' ? 'pass' : (v.state === 'FAIL' ? 'fail' : 'not_evaluated');
        };
        const _VTXT = { pass: '통과', fail: '불합격', not_evaluated: '판정 없음', not_applicable: '해당 없음' };
        const _tone = (k) => ({ pass: 'ok', fail: 'ng', not_evaluated: 'ne' }[k] || 'muted');
        const _uniq = (arr) => arr.filter((x, i) => x != null && x !== '' && arr.indexOf(x) === i);
        const _strs = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
        const _patText = (p) => (p && typeof p === 'object' ? Object.keys(p).map((k) => k + ': ' + (Array.isArray(p[k]) ? p[k].join(',') : p[k])).join('; ') : String(p || ''));

        function _docSection() {
            if (!model || !Array.isArray(model.node) || model.node.length === 0) { return [{ kind: 'para', text: '(단면 미정의)' }]; }
            const blocks = [{ kind: 'section', nodes: RS([], 'length'), elems: RS([], 'count') }];
            blocks[0].nodes.values = model.node.map((n) => [Number(n[1]), Number(n[2])]);
            blocks[0].elems.values = (model.elem || []).map((e) => [Number(e[1]) - 1, Number(e[2]) - 1]);
            const tpl = _selVal('select-template');
            const rows = [['단면 유형', tpl ? _selText('select-template') : '사용자 정의']];
            const T = { length: { US: 4, SI: 1 }, thickness: { US: 4, SI: 2 } };
            if (tpl) {
                [['H (높이)', 'tpl-H', T.length], ['B (플랜지 폭)', 'tpl-B', T.length], ['D (립 깊이)', 'tpl-D', T.length],
                    ['t (두께)', 'tpl-t', T.thickness], ['r (코너 반경)', 'tpl-r', T.length]].forEach((r) => {
                    const v = _exact(r[1], 'length');
                    if (v !== null) { rows.push([r[0] + ' — 템플릿 입력', RQ(v, 'length', { digits: r[2] })]); }
                });
            }
            rows.push(['절점', RQ(model.node.length, 'count')], ['요소', RQ((model.elem || []).length, 'count')]);
            blocks.push({ kind: 'heading', text: '단면 제원' }, { kind: 'table', head: ['항목', '값'], rows });
            if (lastProps) {
                const p = lastProps;
                const P = [['총단면적', 'A', p.A, 'area'], ['강축 단면2차모멘트', 'Ixx', p.Ixx, 'moment_of_inertia'], ['약축 단면2차모멘트', 'Izz', p.Izz, 'moment_of_inertia'],
                    ['단면상승모멘트', 'Ixz', p.Ixz, 'moment_of_inertia'], ['강축 단면계수', 'Sx', p.Sx, 'section_modulus'], ['약축 단면계수', 'Sz', p.Sz, 'section_modulus'],
                    ['강축 소성단면계수', 'Zx', p.Zx, 'section_modulus'], ['약축 소성단면계수', 'Zz', p.Zz, 'section_modulus'],
                    ['강축 회전반경', 'rx', p.rx, 'length'], ['약축 회전반경', 'rz', p.rz, 'length'], ['도심 x', 'xcg', p.xcg, 'length'], ['도심 z', 'zcg', p.zcg, 'length'],
                    ['주축 각도', 'θp', p.thetap, 'angle'], ['주축 단면2차모멘트 1', 'I11', p.I11, 'moment_of_inertia'], ['주축 단면2차모멘트 2', 'I22', p.I22, 'moment_of_inertia']];
                blocks.push({ kind: 'heading', text: '계산된 단면 성질' },
                    { kind: 'table', head: ['성질', '기호', '값'], rows: P.filter((r) => r[2] != null).map((r) => [r[0], r[1], RQ(r[2], r[3])]) });
            }
            return blocks;
        }

        function _docDsm() {
            const blocks = [];
            if (!lastDsmResult) { return [{ kind: 'para', text: '(DSM 결과 없음 — FSM 해석을 먼저 실행하세요)' }]; }
            const dP = lastDsmResult.P || {}, dM = lastDsmResult.Mxx || {};
            const LF = (v) => RQ(v, 'dimensionless', { digits: 4 });
            const row = (lab, v, q, L, lf) => [lab, RQ(v, q), L === undefined ? '' : RQ(L, 'length'), lf === undefined ? '' : LF(lf)];
            blocks.push({ kind: 'table', head: ['성질', '값', '반파장', '하중계수'], rows: [
                ['압축', '', '', ''],
                row('Py (항복)', dP.Py, 'force'), row('Pcrl (국부)', dP.crl, 'force', dP.Lcrl, dP.LF_local),
                row('Pcrd (뒤틀림)', dP.crd, 'force', dP.Lcrd, dP.LF_dist), row('Pcre (전체)', dP.cre, 'force', dP.Lcre, dP.LF_global),
                ['휨', '', '', ''],
                row('My (항복)', dM.P_y, 'moment'), row('Mcrl (국부)', dM.crl, 'moment', dM.Lcrl, dM.LF_local),
                row('Mcrd (뒤틀림)', dM.crd, 'moment', dM.Lcrd, dM.LF_dist), row('Mcre (전체)', dM.cre, 'moment', dM.Lcre, dM.LF_global),
            ] });
            const d0 = dP.n_minima !== undefined ? dP : dM;
            if (d0.n_minima !== undefined) {
                blocks.push({ kind: 'table', head: ['서명곡선의 극소', '반파장', '하중계수'], note: d0.n_minima + '개 극소(엔진이 찾음)',
                    rows: (Array.isArray(d0.minima) ? d0.minima : []).map((m, i) => ['극소 ' + (i + 1), RQ(m.length, 'length'), LF(m.load_factor)]) });
            }
            return blocks;
        }

        function _docBuckling() {
            const blocks = [];
            const pts = analysisResult && Array.isArray(analysisResult.curve) ? analysisResult.curve.filter((r) => r && r.length >= 2 && r[1] > 0) : [];
            if (pts.length > 0) {
                const dsmD = lastDsmResult ? (lastDsmResult.Mxx || lastDsmResult.P) : null;
                const marks = [];
                if (dsmD) {
                    const isM = dsmD.load_type && dsmD.load_type !== 'P';
                    [['Lcrl', 'LF_local', isM ? 'Mcrl' : 'Pcrl'], ['Lcrd', 'LF_dist', isM ? 'Mcrd' : 'Pcrd'], ['Lcre', 'LF_global', isM ? 'Mcre' : 'Pcre']].forEach((k) => {
                        if (dsmD[k[1]] > 0 && dsmD[k[0]] > 0) { marks.push({ label: k[2], L: RQ(dsmD[k[0]], 'length'), LF: RQ(dsmD[k[1]], 'dimensionless', { digits: 3 }) }); }
                    });
                }
                blocks.push({ kind: 'heading', text: '좌굴 곡선 (하중계수 vs. 반파장)' },
                    { kind: 'curve', L: RS(pts.map((p) => p[0]), 'length'), LF: RS(pts.map((p) => p[1]), 'dimensionless'), marks });
            } else {
                blocks.push({ kind: 'para', text: '(좌굴 곡선을 생성하려면 FSM 해석을 먼저 실행하세요)' });
            }
            blocks.push({ kind: 'heading', text: 'DSM 설계값 (좌굴 곡선에서 추출)' });
            return blocks.concat(_docDsm());
        }

        function _docDesignInput(la) {
            const blocks = [];
            const memberType = _selVal('select-member-type');
            const loadMember = LOAD_MEMBERS.includes(memberType);
            const prop = model && Array.isArray(model.prop) && Array.isArray(model.prop[0]) ? model.prop[0] : null;
            const ST = { digits: { US: 2, SI: 1 } };
            const grade = _selVal('input-steel-grade') ? _selText('input-steel-grade') : '직접 입력';
            blocks.push({ kind: 'heading', text: '재료' }, { kind: 'table', head: ['항목', '값'], rows: [
                ['강종', grade],
                ['항복강도 Fy (설계)', RQ(_exact('design-fy', 'stress'), 'stress', ST)],
                ['인장강도 Fu (설계)', RQ(_exact('design-fu', 'stress'), 'stress', ST)],
                ['탄성계수 E (모델)', RQ(prop ? prop[1] : null, 'stress', { digits: { US: 0, SI: 0 } })],
                ['포아송비 ν (모델)', RQ(prop ? prop[3] : null, 'dimensionless', { digits: 3 })],
                ['전단탄성계수 G (모델)', RQ(prop ? prop[5] : null, 'stress', { digits: { US: 0, SI: 0 } })],
            ] });
            const rows = [['부재 적용', _selText('select-member-type')], ['설계 방법', _selVal('select-design-method')]];
            if (loadMember) {
                rows.push(['스팬 유형', _selText('select-span-type') + (la && la.n_spans ? ' (' + la.n_spans + '경간)' : '')]);
                Array.from(document.querySelectorAll('.span-tbl-len')).forEach((el, i) => rows.push(['스팬 ' + (i + 1), RQ(_exactEl(el, 'length_ft'), 'length_ft')]));
                rows.push(['분담폭 (간격)', RQ(_exact('config-spacing', 'length_ft'), 'length_ft')]);
                Array.from(document.querySelectorAll('.span-tbl-lapl')).forEach((el, idx) => {
                    const l = _exactEl(el, 'length_ft');
                    const r = _exactEl(document.querySelector('.span-tbl-lapr[data-idx="' + idx + '"]'), 'length_ft');
                    if (l || r) { rows.push(['랩 — 지점 ' + (idx + 1) + ' 왼쪽', RQ(l, 'length_ft')], ['랩 — 지점 ' + (idx + 1) + ' 오른쪽', RQ(r, 'length_ft')]); }
                });
            }
            blocks.push({ kind: 'heading', text: '부재 구성' }, { kind: 'table', head: ['항목', '값'], rows });
            if (loadMember) {
                const plf = la && la.input_loads_plf ? la.input_loads_plf : null;
                const defs = [['D', 'load-D-psf', '고정하중', ['D']], ['Lr', 'load-Lr-psf', '지붕 활하중', ['Lr']], ['S', 'load-S-psf', '적설하중', ['S']],
                    ['L', 'load-L-psf', '바닥 활하중', ['L']], ['Wu (양력)', 'load-Wu-psf', '풍양력(부압)', ['Wu', 'W']], ['Wp (정압)', 'load-Wp-psf', '풍정압', ['Wp']]];
                const lr = [];
                defs.forEach((d) => {
                    const psf = _exact(d[1], 'pressure');
                    if (psf === null || psf === 0) { return; }
                    const key = plf ? d[3].find((k) => typeof plf[k] === 'number') : undefined;
                    lr.push([d[0], RQ(psf, 'pressure'), key !== undefined ? RQ(Math.abs(plf[key]), 'linload') : '—', d[2]]);
                });
                blocks.push({ kind: 'heading', text: '설계 하중' }, { kind: 'table', head: ['하중', '면하중', '선하중 (하중 해석이 쓴 값)', '설명'], rows: lr });
                const deck = _selVal('select-deck-type');
                if (deck && deck !== 'none') {
                    blocks.push({ kind: 'heading', text: '데크 정보' }, { kind: 'table', head: ['항목', '값'], rows: [
                        ['데크 유형', _selText('select-deck-type')],
                        ['패널 두께 t_panel', RQ(_exact('deck-t-panel', 'length'), 'length', { digits: { US: 4, SI: 2 } })],
                        ['체결구 간격', RQ(_exact('deck-fastener-spacing', 'length'), 'length')],
                    ] });
                }
            }
            return blocks;
        }

        function _docLoadAnalysis(la) {
            const blocks = [];
            const gov = la.governing || la.gravity;
            if (Array.isArray(la.spans_ft) && la.spans_ft.length) {
                blocks.push({ kind: 'beam', spans: RS(la.spans_ft, 'length_ft'), supports: (la.supports || []).map(String),
                    laps: (la.laps_per_support || []).map((l) => ({ left: RQ(l && l.left_ft, 'length_ft'), right: RQ(l && l.right_ft, 'length_ft') })) });
            }
            if (gov && Array.isArray(gov.x_diagram)) {
                const lapMarks = (gov.locations || []).filter((l) => /^Lap end/.test(l.name || '') && l.x_ft != null)
                    .map((l) => ({ label: 'Lap end', x: RQ(l.x_ft, 'length_ft'), y: RQ(l.Mu, 'moment_ft') }));
                if (Array.isArray(gov.M_diagram) && gov.M_diagram.length > 2) {
                    blocks.push({ kind: 'diagram', title: '지배 조합 모멘트: ' + (gov.combo || ''), x: RS(gov.x_diagram, 'length_ft'), y: RS(gov.M_diagram, 'moment_ft'), flip: true, color: '#1565c0', marks: lapMarks });
                }
                if (Array.isArray(gov.V_diagram) && gov.V_diagram.length > 2) {
                    blocks.push({ kind: 'diagram', title: '지배 조합 전단력: ' + (gov.combo || ''), x: RS(gov.x_diagram, 'length_ft'), y: RS(gov.V_diagram, 'force'), flip: false, color: '#e65100', marks: [] });
                }
            }
            if (gov && Array.isArray(gov.locations)) {
                blocks.push({ kind: 'heading', text: '소요강도 포락 (대표 조합: ' + (gov.combo || '') + ')' }, { kind: 'table',
                    head: ['위치', 'x', 'Mu', 'Vu', 'R 지압', 'R 인발', '구간', 'Mu 의 조합 · 패턴', 'Vu 의 조합 · 패턴'],
                    rows: gov.locations.map((l) => [l.name || '', RQ(l.x_ft, 'length_ft'), RQ(l.Mu, 'moment_ft'), RQ(l.Vu, 'force'),
                        RQ(l.R_bearing != null ? l.R_bearing : (l.R_uplift == null ? l.Ru : null), 'force'), RQ(l.R_uplift, 'force'), l.region || '',
                        [l.combo, _patText(l.pattern)].filter(Boolean).join(' · '), [l.combo_V, _patText(l.pattern_V)].filter(Boolean).join(' · ')]) });
            }
            if (la.uplift && Array.isArray(la.uplift.locations)) {
                blocks.push({ kind: 'heading', text: '양력 지배 하중조합: ' + (la.uplift.combo || '') }, { kind: 'table', head: ['위치', 'Mu'],
                    rows: la.uplift.locations.map((l) => [l.name || '', RQ(l.Mu, 'moment_ft')]) });
            }
            if (Array.isArray(la.all_combos_detail) && la.all_combos_detail.length > 0) {
                const plf = la.input_loads_plf || {};
                const lab = { D: '고정(D)', Lr: '지붕활(Lr)', S: '적설(S)', L: '활(L)', W: '풍(W)', E: '지진(E)', R: '우수(R)' };
                blocks.push({ kind: 'heading', text: '하중조합 상세 (' + (la.design_method || '') + ', ASCE 7)' },
                    { kind: 'table', head: ['하중', '선하중'], rows: Object.keys(plf).map((k) => [lab[k] || k, RQ(Math.abs(plf[k]), 'linload')]) },
                    { kind: 'table', head: ['조합', '계수', '|M|max', '|V|max', '지배'], rows: la.all_combos_detail.map((cd) => [cd.name || '',
                        Object.keys(cd.factors || {}).filter((k) => plf[k] != null).map((k) => (cd.factors[k] === 1 ? '' : cd.factors[k] + '×') + (lab[k] || k)).join(' + '),
                        RQ(cd.max_abs_M, 'moment_ft'), RQ(cd.max_abs_V, 'force'),
                        { text: [cd.governs_overall ? '★지배' : '', cd.governs_gravity ? '중력 지배' : '', cd.governs_uplift ? '양력 지배' : ''].filter(Boolean).join(' '), tone: cd.governs_overall ? 'ok' : '' }]) });
            }
            if (la.auto_params) {
                const ap = la.auto_params;
                const rows = [];
                if (ap.deck && ap.deck.type !== 'none') {
                    rows.push(['kφ (회전강성)', RQ(ap.deck.kphi, 'rotational_stiffness'), ap.deck.kphi_method === 'test_override' ? '프로젝트 시험 입력값' : 'Gao & Moen (2011) 식 — Design Manual II-1C 방식 예비설계값']);
                    rows.push(['kx (횡강성)', RQ(ap.deck.kx, 'lat_stiff'), ap.deck.kx_method === 'test_override' ? '프로젝트 시험 입력값' : 'AISI RP17-2 곡선 맞춤식 — II-1C 패스너 값 기준 예비설계값']);
                    const dn = _deckNotes(ap.deck);
                    dn.warnings.forEach((w) => rows.push(['주의', '', userText(w)]));
                    dn.assumptions.forEach((a) => rows.push(['가정', '', userText(a)]));
                    dn.scope.forEach((s) => rows.push(['범위', '', userText(s)]));
                }
                if (ap.positive_region) {
                    if (ap.positive_region.braced) { rows.push(['정모멘트 Ly(+)', RQ(0, 'length'), '상부 플랜지 압축 — 데크 패널로 연속 지지(LTB 없음)']); }
                    else {
                        rows.push(['정모멘트 Ly(+)', RQ(ap.positive_region.Ly_in, 'length'), '상부 플랜지 비지지 — 변곡점 간 거리']);
                        rows.push(['정모멘트 Cb(+)', RQ(ap.positive_region.Cb, 'dimensionless', { digits: 2 }), 'Eq. F2.1.1-2 — 정모멘트 구간 모멘트도에서']);
                    }
                }
                if (ap.negative_region) {
                    rows.push(['부모멘트 Ly', RQ(ap.negative_region.Ly_in, 'length'), '변곡점에서 랩 끝 또는 지점까지 — 하부 플랜지 압축, 비지지']);
                    rows.push(['부모멘트 Cb', RQ(ap.negative_region.Cb, 'dimensionless', { digits: 2 }), 'Eq. F2.1.1-2 — 비지지 구간 모멘트도에서']);
                }
                if (ap.uplift_R != null) {
                    rows.push(['양력 R (§I6.2.1)', RQ(ap.uplift_R, 'dimensionless', { digits: 2 }), '표 I6.2.1-1 — ' + (ap.uplift_R_basis || '')]);
                } else if (ap.i621_check || ap.uplift_R === null) {
                    const rs = ap.i621_check && Array.isArray(ap.i621_check.reasons) ? ap.i621_check.reasons.map(_koText).join('; ') : '';
                    rows.push(['양력 R (§I6.2.1)', '— (적용 안 함)', '§I6.2.1 조건 미확인 또는 불충족 — R 법으로 판정하지 않음' + (rs ? ': ' + rs : '')]);
                }
                if (ap.unbraced && Array.isArray(ap.unbraced.inflection_points_ft)) {
                    ap.unbraced.inflection_points_ft.forEach((v, i) => rows.push(['변곡점 ' + (i + 1), RQ(v, 'length_ft'), '모멘트 = 0 인 위치(하중 해석)']));
                }
                blocks.push({ kind: 'heading', text: '자동 결정 설계 매개변수' }, { kind: 'table', head: ['매개변수', '값', '근거'], rows });
            }
            const df = la.deflection;
            if (df && df.valid !== false && Array.isArray(df.per_span)) {
                blocks.push({ kind: 'heading', text: '처짐 (사용하중 합계: ' + (df.combo || '') + ')' });
                if (Array.isArray(df.D_diagram) && df.D_diagram.length > 2 && gov && Array.isArray(gov.x_diagram)) {
                    blocks.push({ kind: 'diagram', title: '처짐', x: RS(gov.x_diagram, 'length_ft'), y: RS(df.D_diagram, 'length'), flip: true, color: '#66bb6a', marks: [] });
                }
                blocks.push({ kind: 'table', head: ['스팬', '위치', '최대 처짐', 'L/δ'], rows: df.per_span.map((p) => [String(p.span),
                    RQ(p.x_ft, 'length_ft'), RQ(p.abs_delta_in, 'length'), RQ(p.L_over_delta, 'dimensionless', { digits: 0 })]) });
                blocks.push({ kind: 'table', head: ['처짐 계산의 값', ''], rows: [['E', RQ(df.E_ksi, 'stress', { digits: { US: 0, SI: 0 } })], ['Ixx', RQ(df.Ixx, 'moment_of_inertia')]] });
                const cases = Array.isArray(la.deflection_cases) ? la.deflection_cases : [];
                if (cases.length) {
                    const rows = [];
                    cases.forEach((c) => (Array.isArray(c.per_span) ? c.per_span : []).forEach((p, i) => rows.push([c.case || '', c.basis || '', String(p.span != null ? p.span : i + 1),
                        RQ(p.abs_delta_in, 'length'), RQ(p.L_over_delta, 'dimensionless', { digits: 0 })])));
                    blocks.push({ kind: 'table', head: ['하중 경우', '뜻', '스팬', '최대 처짐', 'L/δ'], rows, note: '하중 경우마다의 처짐(엔진 deflection_cases) — 활하중 한계는 활하중 단독(L · Lr · S · R)에 댄다' });
                }
            } else if (df && df.valid === false) {
                blocks.push({ kind: 'heading', text: '처짐' }, { kind: 'para', tone: 'ng', text: '처짐 해석이 실패하여 결과를 사용할 수 없습니다. FE 해석 설정과 지점 · 랩 입력을 확인하세요.' });
            }
            return blocks;
        }

        /** 결과 하나의 검토 항목(design_checks) 블록 — 없으면 그렇다고 */
        function _checkBlocks(r) {
            const list = r && Array.isArray(r.design_checks) ? r.design_checks : null;
            if (!list || list.length === 0) { return [{ kind: 'para', tone: 'muted', text: '이 결과에는 검토 항목(design_checks)이 없습니다 — 계산 과정을 보이지 않습니다.' }]; }
            return list.map((c) => ({ kind: 'check', check: _koCheck(c) }));
        }
        function _noticeBlocks(r, extra) {
            const e = extra || {};
            return [
                { kind: 'list', tone: 'ne', title: '평가하지 못한 항목 (판정 없음의 원인)', items: _uniq(_notEvalList(r).concat(_strs(e.ne).map(_koText))) },
                { kind: 'list', tone: 'muted', title: '검토하지 않은 항목 — 해당하면 별도 검토', items: _uniq(_strs(r && r.not_checked)) },
                { kind: 'list', tone: 'warn', title: '경고 (값 또는 판정에 영향)', items: _uniq(_warnList(r).concat(_strs(e.warn).map(_koText))) },
                { kind: 'list', title: '가정', items: _uniq(_assumpList(r).concat(_strs(e.asm).map(_koText))) },
                { kind: 'list', tone: 'muted', title: '적용 범위', items: _uniq(_scopeList(r)) },
            ];
        }
        const PURLIN_PARTS = [['design_negative', '부모멘트 구간'], ['design_positive', '정모멘트 구간'], ['design_lap', '랩 구간'], ['design_uplift', '양력 구간']];
        function _docDesignCalc(d) {
            const blocks = [];
            if (d.purlin_mode) {
                PURLIN_PARTS.forEach(([key, name]) => {
                    const g = d[key];
                    if (!g) { return; }
                    const rg = g.region || {};
                    blocks.push({ kind: 'heading', text: name + ' (지배): ' + (rg.label || rg.id || '') });
                    blocks.push({ kind: 'table', head: ['구간 값', ''], rows: [['Ly (구간이 쓴 비지지 길이)', RQ(rg.Ly_in, 'length')], ['Cb', RQ(rg.Cb, 'dimensionless', { digits: 2 })],
                        ['부재 수', RQ(rg.members, 'count')]] });
                    const pts = Array.isArray(g.checks) ? g.checks : [];
                    if (pts.length) {
                        blocks.push({ kind: 'table', head: ['검토 지점', '하중 조합 · 패턴', 'Mu', 'Vu', '이용률', '판정'], rows: pts.map((p) => [p.check_point || '', p.combination || '',
                            RQ(p.Mu, 'moment'), RQ(p.Vu, 'force'), RQ(p.utilization, 'dimensionless', { digits: 3 }),
                            { text: p.error ? '오류: ' + p.error : _VTXT[p.pass === true ? 'pass' : (p.pass === false ? 'fail' : 'not_evaluated')], tone: _tone(p.pass === true ? 'pass' : (p.pass === false ? 'fail' : 'not_evaluated')) }]) });
                        const asm = _uniq([].concat(...pts.map((p) => (Array.isArray(p.notices) ? _assumpList(p) : _strs(p.assumptions).map(_koText)).map((a) => '[' + (p.check_point || '') + '] ' + a))));
                        blocks.push({ kind: 'list', title: '검토 지점의 가정', items: asm });
                        const hostA = _uniq(pts.map((p) => p.host_assumption).filter(Boolean));
                        blocks.push({ kind: 'list', title: '호스트 가정', items: hostA });
                    }
                    blocks.push(...(_checkBlocks(g)));
                });
                if (Array.isArray(d.purlin_regions)) {
                    blocks.push({ kind: 'heading', text: '모든 구간' }, { kind: 'table', head: ['구간', '종류', 'Ly', 'Cb', '이용률', '판정', '지배 검토'],
                        rows: d.purlin_regions.map((rg) => {
                            const rr = rg && rg.result;
                            const k = rr && !rr.error ? _verdictKey(rr) : 'not_evaluated';
                            return [rg.label || rg.id || '', rg.kind || '', RQ(rg.Ly_in, 'length'), RQ(rg.Cb, 'dimensionless', { digits: 2 }),
                                RQ(rr && rr.utilization, 'dimensionless', { digits: 3 }), { text: rr && rr.error ? '오류: ' + rr.error : _VTXT[k], tone: _tone(k) }, (rr && rr.governing_check) || ''];
                        }) });
                }
            } else {
                blocks.push(..._checkBlocks(d));
            }
            if (_lastLapResult && Array.isArray(_lastLapResult.design_checks)) {
                blocks.push({ kind: 'heading', text: '랩 접합 (§J · 2겹 휨)' }, ..._checkBlocks(_lastLapResult));
            }
            return blocks;
        }

        function _docSummary(d, la) {
            const blocks = [];
            const k = _verdictKey(d);
            const govCombo = (d.purlin_governing && d.purlin_governing.combo) || ((la && (la.governing || la.gravity)) || {}).combo || '';
            blocks.push({ kind: 'table', head: ['항목', '값'], rows: [
                ['설계 기준', 'AISI S100-16'], ['부재 유형', d.member_type || ''], ['설계 방법', d.design_method || ''],
                ['종합 판정 (엔진)', { text: _VTXT[k], tone: _tone(k) }], ['이용률 (엔진)', RQ(d.utilization, 'dimensionless', { digits: 3 })],
                ['지배 파괴 모드 (엔진)', d.controlling_mode || ''], ['지배 검토 (엔진)', d.governing_check || ''],
                ['지배 구간', d.purlin_governing ? (d.purlin_governing.label || '') : ''], ['지배 하중조합', govCombo],
                ['참조 조항', (d.spec_sections || []).join(', ')],
            ].filter((r) => r[1] !== '') });
            const govs = [];
            const collect = (r, where) => (r && Array.isArray(r.design_checks) ? r.design_checks : []).filter((c) => c && c.governs).forEach((c) => govs.push([where,
                c.name_ko || c.id, c.clause || '', c.demand ? RQ(c.demand.value, c.demand.quantity, { unbounded: c.demand.unbounded }) : '—',
                c.capacity ? RQ(c.capacity.value, c.capacity.quantity) : '—', RQ(c.ratio, 'dimensionless', { digits: 3 }), { text: _VTXT[c.verdict] || c.verdict, tone: _tone(c.verdict) }]));
            if (d.purlin_mode) { PURLIN_PARTS.forEach(([key, name]) => collect(d[key], name)); } else { collect(d, ''); }
            if (_lastLapResult) { collect(_lastLapResult, '랩 접합'); }
            if (govs.length) {
                blocks.push({ kind: 'heading', text: '무리마다 지배 항목 (엔진 design_checks)' },
                    { kind: 'table', head: ['자리', '항목', '조항', '소요', '설계강도', '비', '판정'], rows: govs });
            }
            const _pl = UTILS.purlinLists(d, _uo);
            blocks.push(..._noticeBlocks(d, { ne: _pl.ne, warn: (d.dsm_warnings || []).concat(_pl.warn), asm: _pl.asm }));
            if (k === 'not_evaluated') {
                blocks.push({ kind: 'para', tone: 'ne', text: d.utilization == null ? '판정 없음: 소요값이 없어 판정하지 않았습니다(강도 조회).'
                    : '판정 없음: 미평가 한계상태가 있어 전체 적합을 확정할 수 없습니다. 위 항목을 해소할 입력을 추가한 뒤 다시 검토하십시오.' });
            }
            return blocks;
        }

        /** K3-7: 상세 보고서의 데이터(US). opts.stamp · opts.appendSections 는 호스트의 안쪽 고리(기록) — 블록으로 */
        function buildReportDoc(opts) {
            const o = opts || {};
            const d = _lastDesignResult, la = _lastLoadAnalysis;
            const sections = [
                { id: 'section', title: '단면', blocks: _docSection() },
                { id: 'buckling', title: '탄성 좌굴 해석', blocks: _docBuckling() },
                { id: 'input', title: '설계 입력', blocks: _docDesignInput(la) },
            ];
            if (la) { sections.push({ id: 'load_analysis', title: '하중 분석 결과', blocks: _docLoadAnalysis(la) }); }
            if (d) {
                const mt = { compression: '압축 (Chapter E)', flexure: '휨 (Chapter F)', combined: '조합 (Chapters E+F+H)', tension: '인장 (Chapter D)', connection: '접합 (Chapter J)' }[d.member_type || ''] || (d.member_type || '');
                sections.push({ id: 'calculation', title: '설계 계산 — ' + mt + ' (엔진 검토 항목)', blocks: _docDesignCalc(d) });
                sections.push({ id: 'summary', title: '설계 요약', blocks: _docSummary(d, la) });
            }
            (Array.isArray(o.appendSections) ? o.appendSections : []).forEach((s, i) => {
                if (!s || typeof s !== 'object') { return; }
                const blocks = Array.isArray(s.blocks) ? s.blocks : (s.html != null || s.text != null ? [{ kind: 'para', text: String(s.text != null ? s.text : s.html) }] : []);
                sections.push({ id: 'append.' + (i + 1), title: String(s.title || ''), blocks });
            });
            return {
                schema: 'stcfsd-report/1',
                meta: { title: 'StCFSD — 냉간성형강 설계 보고서', date: _reportDate(), spec: 'AISI S100-16', method: '직접강도법 (DSM)', units: 'US',
                    design_method: d ? (d.design_method || '') : '', member_type: d ? (d.member_type || '') : '',
                    stamp: o.stamp && typeof o.stamp === 'object' ? o.stamp : null },
                verdict: d ? { state: _verdictKey(d), utilization: RQ(d.utilization, 'dimensionless', { digits: 3 }), governing: d.governing_check || d.controlling_mode || '' } : null,
                sections,
            };
        }

        /** K3-7: 좌굴 보고서의 데이터(US). page.charts = 화면 캔버스의 PNG(data:image/png;base64 만), headless = 화면 없이 */
        function buildBucklingDoc(page) {
            const pg = page || {};
            const L = model && Array.isArray(model.lengths) ? model.lengths.map(Number).filter((v) => isFinite(v) && v > 0) : [];
            const prop = model && Array.isArray(model.prop) && Array.isArray(model.prop[0]) ? model.prop[0] : null;
            const tpl = _selVal('select-template');
            const cond = [['단면', tpl ? _selText('select-template') : '직접 입력']];
            if (tpl) { [['H', 'tpl-H'], ['B', 'tpl-B'], ['D', 'tpl-D'], ['t', 'tpl-t']].forEach((r) => { const v = _exact(r[1], 'length'); if (v !== null) { cond.push([r[0] + ' (템플릿 입력)', RQ(v, 'length')]); } }); }
            cond.push(['기준응력 fy (모델 — 해석이 쓴 값)', RQ(model && model.loadFy, 'stress', { digits: { US: 2, SI: 1 } })],
                ['E (모델)', RQ(prop ? prop[1] : null, 'stress', { digits: { US: 0, SI: 0 } })], ['ν (모델)', RQ(prop ? prop[3] : null, 'dimensionless', { digits: 3 })],
                ['하중 케이스 (모델)', String((model && model.loadCase) || '')], ['경계조건 (모델)', String((model && model.BC) || '')],
                ['반파장 최솟값', RQ(L.length ? Math.min(...L) : null, 'length')], ['반파장 최댓값', RQ(L.length ? Math.max(...L) : null, 'length')],
                ['반파장 개수', RQ(L.length, 'count')], ['절점', RQ(model && model.node ? model.node.length : 0, 'count')], ['요소', RQ(model && model.elem ? model.elem.length : 0, 'count')]);
            const sections = [{ id: 'conditions', title: '해석 조건', blocks: [{ kind: 'table', head: ['항목', '값'], rows: cond }] },
                { id: 'buckling', title: '서명곡선 · DSM 값', blocks: _docBuckling() }];
            const charts = [['buckling-curve-canvas', '좌굴 곡선 (Signature Curve)'], ['classify-curve-canvas', '모드 분류 (G/D/L/O)'],
                ['mode-shape-canvas', '모드 형상 (2D)'], ['mode-shape-3d-canvas', '모드 형상 (3D)'], ['plastic-surface-canvas', '소성 상호작용 곡면']];
            const imgs = [];
            charts.forEach(([id, title]) => {
                const src = pg.charts && typeof pg.charts[id] === 'string' ? pg.charts[id] : '';
                if (/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)) { imgs.push({ kind: 'heading', text: title }, { kind: 'image', src }); }
            });
            if (imgs.length) { sections.push({ id: 'charts', title: '화면 그림', blocks: imgs.concat([{ kind: 'para', tone: 'muted', text: '그림은 해석 시점의 화면 렌더링을 캡처한 것입니다.' }]) }); }
            else if (pg.headless) {
                sections[1].blocks.push({ kind: 'para', tone: 'warn', text: '화면 없이 만든 보고서입니다 — 그림은 서명곡선(SVG)만 넣었습니다. 모드 형상 · 분류 · 소성 곡면 그림은 화면이 열려 있을 때 만든 보고서에 들어갑니다.' });
            }
            return { schema: 'stcfsd-report/1', meta: { title: '좌굴해석 결과 보고서 (FSM — Signature Curve)', date: _reportDate(), spec: 'AISI S100-16', method: 'FSM', units: 'US', stamp: null }, verdict: null, sections };
        }

        /** 화면 · 옛 부름: ReportDoc 을 그 단위로 그린 HTML(SI 는 env.reportToSI — 호스트의 siUnits) */
        function _render(doc) {
            const shown = _unitSystem === 'SI' && typeof env.reportToSI === 'function' ? env.reportToSI(doc) : doc;
            return RENDER.renderReportDoc(shown);
        }
        function generateDetailedReport(opts) { return _render(buildReportDoc(opts)); }
        function _buildBucklingReportHtml(page) { return _render(buildBucklingDoc(page)); }
        function buildBucklingReportHeadless() { return _render(buildBucklingDoc({ headless: true })); }

        function _statusFromVerdict(v, ratio) {
            if (v.state === 'FAIL') { return 'fail'; }
            if (v.state !== 'PASS') { return 'warn'; }
            return (typeof ratio === 'number' && ratio > 0.95) ? 'warn' : 'pass';
        }

        return {
            runAllValidationChecks, renderValidationDashboard, generateDetailedReport, buildReportDoc, buildBucklingDoc,
            buildBucklingReportHtml: _buildBucklingReportHtml, buildBucklingReportHeadless,
        };
    }

    /**
     * 검증 항목의 고정 id(K3 결정 10) — 표 하나. [id, 화면 이름(한글 — 표시 이름), 번호가 붙는 이름이면 그 앞부분]. 이름은 지금 화면의 글 그대로.
     * 번호가 붙는 항목(스팬 · 지점 · 경고 #)은 id 뒤에 「.<번호>」.
     */
    const VALIDATION_IDS = [
        ['val.section.defined', '단면 정의'], ['val.section.b4_engine', '표 B4.1-1 적용 한계 (엔진)'], ['val.section.thickness', '두께 (t)'], ['val.section.web_wt', '웹 w/t 비'],
        ['val.section.flange_bt', '플랜지 b/t 비'], ['val.section.lip_dt', '립 d/t 비'], ['val.section.corner_rt', '코너 R/t 비'],
        ['val.material.fy', '항복강도 (Fy)'], ['val.material.fu_fy', 'Fu/Fy 비'], ['val.material.fu', '인장강도 (Fu)'],
        ['val.buckling.length_min', '반파장 최솟값'], ['val.buckling.length_max', '반파장 최댓값'], ['val.buckling.length_count', '반파장 개수'],
        ['val.buckling.bc', '경계조건 (BC)'], ['val.buckling.load_case', 'Load Case 적합성'], ['val.buckling.analysis_run', '해석 실행 여부'],
        ['val.buckling.dsm_extracted', 'DSM 값 추출'], ['val.buckling.mcrl', 'Mcrl 식별 (국부좌굴)'], ['val.buckling.mcrd', 'Mcrd 식별 (뒤틀림좌굴)'],
        ['val.props.computed', '성질 계산 여부'], ['val.props.sx', '단면계수 Sx'], ['val.props.r', '회전반경 rx, rz'],
        ['val.loads.span', '스팬 길이'], ['val.loads.spacing', '분담폭 (간격)'], ['val.loads.dead', '고정하중 (D)'],
        ['val.loads.gravity_live', '중력 활하중/적설하중'], 
        ['val.load_analysis.run', '하중 분석 실행 여부'], ['val.load_analysis.max_mu', '최대 Mu'], ['val.load_analysis.vu', '전단력 (Vu)'],
        ['val.load_analysis.ly_negative', '비지지 길이 Ly (부모멘트)'], ['val.load_analysis.cb_negative', '모멘트 구배 Cb'],
        ['val.load_analysis.uplift_r', '양력 R 계수 (§I6.2.1)'], ['val.load_analysis.ly_positive', '비지지 길이 Ly(+) (정모멘트)'],
        ['val.load_analysis.cb_positive', '모멘트 구배 Cb(+)'], 
        ['val.load_analysis.lap_end_mu', 'Lap 끝단 Mu 추출'], ['val.load_analysis.deflection_span', '처짐 — 스팬 ', true],
        ['val.load_analysis.deflection', '처짐 검토'],
        ['val.design.run', '설계 검토 실행 여부'], ['val.design.overall', '종합 판정 (엔진)'], ['val.design.mne_my', 'Mne vs My'],
        ['val.design.inelastic_reserve', '§F2.4.2 Inelastic Reserve'], ['val.design.uplift_r', '§I6.2.1 R-factor (양력)'],
        ['val.design.cold_work', '§A3.3.2 Cold Work (냉간가공)'], ['val.design.cold_work_ir', '§A3.3.2 ↔ §F2.4.2 배타 관계'],
        ['val.design.mnl_mne', 'Mnl vs Mne (국부좌굴 감소)'], ['val.design.mnd_my', 'Mnd vs My (뒤틀림좌굴 감소)'],
         ['val.design.positive_phimn', '정모멘트 φMn(+)'],
         ['val.design.pnl_pne', 'Pnl vs Pne (국부좌굴 감소)'], ['val.design.pnd_py', 'Pnd vs Py (뒤틀림좌굴 감소)'],
        ['val.design.util_negative', '이용률 — 부모멘트 (-M)'], ['val.design.lb_cb_negative', 'Lb(-) / Cb(-) (부모멘트)'],
        ['val.design.utilization', '이용률 (DCR)'], ['val.design.util_positive', '이용률 — 정모멘트 (+M)'],
        ['val.design.lb_cb_positive', 'Lb(+) / Cb(+) (정모멘트)'],  ['val.design.interaction', '조합 검토 (§H1.2)'],
        ['val.design.dsm_warning', 'DSM 경고 #', true], ['val.design.fallback', '뒤틀림좌굴 해석적 Fallback'], ['val.design.warning', '설계 경고 #', true],
        ['val.design.dsm_extract_warning', 'DSM 추출 경고'],
        ['val.lap.flexure', 'Lap 구간 휨강도 (§F3, 한 부재)'], ['val.lap.length', 'Lap 길이 (지점 ', true], ['val.lap.fastener', 'Lap 패스너 전단 (DCR)'],
        ['val.lap.flexure_dcr', 'Lap 휨강도 DCR (2겹 §F3/F4/H2)'], ['val.lap.overall', 'Lap 접합부 종합 판정'], ['val.lap.run', 'Lap 접합부 설계 실행 여부'],
        ['val.consistency.fy', 'Fy 일관성 (해석 vs 설계)'], ['val.consistency.analysis_current', '해석 최신성'],
    ];
    /** 항목 이름 → 고정 id(번호가 붙는 것은 「.<번호>」). 표에 없으면 null(시험 review_contract 가 없음을 확인한다) */
    function validationId(item) {
        const s = String(item || '');
        for (const [id, name, numbered] of VALIDATION_IDS) {
            if (!numbered && s === name) { return id; }
            if (numbered && s.startsWith(name)) { const m = /(\d+)/.exec(s.slice(name.length)); return m ? id + '.' + m[1] : id; }
        }
        return null;
    }
    /** 검증 항목에 id 를 붙인 것(화면 · MCP · 새 화면이 같은 목록) */
    function withIds(checks) { return (checks || []).map((c) => ({ id: validationId(c.item), ...c })); }

    /** K3-5: 「PDF 저장」 의 인쇄용 HTML — app.js 의 틀 그대로(밝은 색 변수 · 인쇄 CSS)에 보고서 칸의 글을 넣는다 */
    function printableReportHtml(inner) {
        // V7-02: 문서에 CSP — 스크립트 · 외부 자원 없음(인라인 스타일과 data: 그림만). src/case/pdfPrint.ts REPORT_CSP 와 같은 글
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>CUFSM Design Report</title>
            <style>
                :root{
                    --vscode-foreground:#222;
                    --vscode-descriptionForeground:#666;
                    --vscode-editor-background:#fff;
                    --vscode-panel-border:#ccc;
                    --vscode-errorForeground:#c62828;
                    --vscode-editor-selectionBackground:#e3f2fd;
                    --vscode-inputValidation-warningForeground:#e65100;
                }
                body{font-family:'Segoe UI',sans-serif;font-size:11px;color:#222;max-width:800px;margin:0 auto;padding:20px;line-height:1.7}
                h1{font-size:16px;border-bottom:2px solid #333;padding-bottom:6px;margin-top:0;margin-bottom:16px}
                h2{font-size:14px;color:#1565c0;border-bottom:1px solid #ccc;padding-bottom:4px;margin-top:28px;margin-bottom:12px}
                h3{font-size:12px;color:#333;margin-top:18px;margin-bottom:8px}
                p{margin:6px 0;line-height:1.7}
                table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:11px}
                th,td{border:1px solid #ccc;padding:4px 8px;text-align:left;line-height:1.5}
                th{background:#f0f0f0;font-weight:600}
                .eq{font-family:'Cambria Math','Times New Roman',serif;font-style:italic;font-size:12px;padding:6px 10px;background:#f8f8ff;border-left:3px solid #1565c0;margin:8px 0;display:block;line-height:1.8}
                .result{font-weight:700;color:#1565c0}
                .pass{color:#2e7d32;font-weight:700} .fail{color:#c62828;font-weight:700} .warn{color:#e65100;font-weight:700}
                .section-fig{text-align:center;margin:12px 0}
                svg text{font-family:'Segoe UI',sans-serif}
                hr{margin:16px 0;border:none;border-top:1px solid #ddd}
                svg line[stroke-opacity]{stroke-opacity:0.6}
                svg path[fill-opacity]{fill-opacity:0.25}
                svg polygon[fill-opacity]{fill-opacity:0.7}
                @media print{body{font-size:10px;line-height:1.6} .no-print{display:none} h2{page-break-before:auto}}
            </style></head><body>${inner}</body></html>`;
    }

    /**
     * 기록 갈래(R5 · docs/implementation/20261124-records-design.md §6.2)가 붙일 자리 — 보고서 글은 그대로 두고 감싼다.
     *  stamp: ReportDoc.meta.stamp {kind: 'draft' | 'issued', label?, notChecked?, reviewer?, date?} — 화면 · 인쇄 모두 맨 위 띠,
     *         인쇄에서는 쪽마다(position: fixed — Chromium 은 인쇄의 쪽마다 되풀이한다)
     *  appendSections: [{title, html}] — 맺음말(마지막 <hr>) 앞에 절로 덧붙인다(가정 · 검토 기록 …). html 은 호출자가 이스케이프한 것
     * K3-7 의 ReportDoc(자료 모델)에서는 meta.stamp · sections.push 로 같은 뜻 — 이 함수가 그 그리기를 맡는다.
     */
    function composeReport(inner, opts) {
        const o = opts || {};
        let h = String(inner || '');
        const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (Array.isArray(o.appendSections) && o.appendSections.length) {
            const add = o.appendSections.map((sct) => '<h2>' + esc(sct && sct.title) + '</h2>' + String((sct && sct.html) || '')).join('');
            const at = h.lastIndexOf('<hr>');
            h = at >= 0 ? h.slice(0, at) + add + h.slice(at) : h + add;
        }
        const st = o.stamp;
        if (st && typeof st === 'object' && (st.kind === 'draft' || st.kind === 'issued')) {
            const parts = [st.kind === 'issued' ? '발행' : '초안'];
            if (st.label) { parts.push(esc(st.label)); }
            if (st.notChecked) { parts.push('확인 안 함'); }
            if (st.reviewer) { parts.push('검토 ' + esc(st.reviewer)); }
            if (st.date) { parts.push(esc(st.date)); }
            const color = st.kind === 'issued' ? '#2e7d32' : '#e65100';
            h = '<div class="report-stamp report-stamp-' + st.kind + '" style="border:1px solid ' + color + ';color:' + color
                + ';font-size:10px;padding:2px 6px;margin-bottom:8px">' + parts.join(' · ') + '</div>'
                + '<style>@media print{.report-stamp{position:fixed;top:0;right:0;background:#fff}}</style>' + h;
        }
        return h;
    }

    return { THRESHOLDS, UNIT, make, VALIDATION_IDS, validationId, withIds, printableReportHtml, composeReport, renderReportDoc: RENDER.renderReportDoc };
}));
