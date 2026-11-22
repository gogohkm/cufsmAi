(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdDesignState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // ─────────────────────────────────────────────────────────────────────────
    // 입력 칸 한 표(W3 · V4-09): .csd 저장 키, DOM id, 단위 종류, 종류.
    // 단위 전환(app.js refreshUnits)과 저장 · 복원이 이 표 하나를 쓴다 — 단위가 있는 <input> 은
    // 반드시 여기 있어야 한다(test/webview/design_state_v13_contract.js 가 HTML 을 읽어 확인).
    // 값은 언제나 US 내부값으로 저장한다. 빈 칸은 null(= 입력 없음 — 지어낸 값이 아님, V4-06/07).
    // kind: num(수) · sel(선택) · chk(체크) · list(쉼표 목록) · raw(단위 없는 수를 표시값 그대로)
    // ─────────────────────────────────────────────────────────────────────────
    const FIELDS = [
        // 재료 · 설계 방법
        ['fy', 'design-fy', 'stress', 'num'],
        ['fu', 'design-fu', 'stress', 'num'],
        ['designMethod', 'select-design-method', null, 'sel'],
        ['memberType', 'select-member-type', null, 'sel'],
        ['presteelGrade', 'input-steel-grade', null, 'sel'],
        ['fyLoad', 'input-fy', 'stress', 'num'],
        ['fuPre', 'input-fu', 'stress', 'num'],
        ['inputE', 'input-E', 'stress', 'num'],
        ['inputG', 'input-G', 'stress', 'num'],
        ['inputV', 'input-v', null, 'num'],
        ['plasticFy', 'plastic-fy', 'stress', 'num'],
        // 부재 구성 (경간 표는 따로)
        ['spanType', 'select-span-type', null, 'sel'],
        ['nSpans', 'config-n-spans', null, 'num'],
        ['spacing', 'config-spacing', 'length_ft', 'num'],
        // 하중
        ['loadD', 'load-D-psf', 'pressure', 'num'],
        ['loadLr', 'load-Lr-psf', 'pressure', 'num'],
        ['loadS', 'load-S-psf', 'pressure', 'num'],
        ['loadWu', 'load-Wu-psf', 'pressure', 'num'],
        ['loadWp', 'load-Wp-psf', 'pressure', 'num'],
        ['loadL', 'load-L-psf', 'pressure', 'num'],
        ['chkPatternLoading', 'chk-pattern-loading', null, 'chk'],
        ['chkLrReduced', 'chk-lr-reduced', null, 'chk'],
        ['spanIxIn4', 'span-Ix-list', 'inertia', 'list'],
        // 데크 · 가새 · §I6.2.1
        ['deckType', 'select-deck-type', null, 'sel'],
        ['deckTPanel', 'deck-t-panel', 'thickness', 'num'],
        ['deckFastenerSpacing', 'deck-fastener-spacing', 'length', 'num'],
        ['deckKphiOverride', 'deck-kphi-override', 'rotStiff', 'num'],
        ['deckKxOverride', 'deck-kx-override', 'latStiff', 'num'],
        ['bracePointsFt', 'brace-points', 'length_ft', 'list'],
        ['chkI621Confirmed', 'chk-i621-confirmed', null, 'chk'],
        ['deckInsulationIn', 'deck-insulation', 'length', 'num'],
        ['deckRTested', 'deck-R-tested', null, 'num'],
        // 설계 길이 · 계수 · 소요강도
        ['KxLx', 'design-KxLx', 'length', 'num'],
        ['KyLy', 'design-KyLy', 'length', 'num'],
        ['KtLt', 'design-KtLt', 'length', 'num'],
        ['Lb', 'design-Lb', 'length', 'num'],
        ['Cb', 'design-Cb', null, 'num'],
        ['designLbPos', 'design-Lb-pos', 'length', 'num'],
        ['designCbPos', 'design-Cb-pos', null, 'num'],
        ['Cmx', 'design-Cmx', null, 'num'],
        ['Cmy', 'design-Cmy', null, 'num'],
        ['Pu', 'design-P', 'force', 'num'],
        ['Vu', 'design-V', 'force', 'num'],
        ['Mux', 'design-Mx', 'moment', 'num'],
        ['designMxPos', 'design-Mx-pos', 'moment', 'num'],
        ['Muy', 'design-My', 'moment', 'num'],
        ['MayStrength', 'design-May-strength', 'moment', 'num'],
        ['chkBetaDist', 'chk-beta-dist', null, 'chk'],
        ['distM1M2', 'design-dist-M1M2', null, 'num'],
        ['distLm', 'design-dist-Lm', 'length', 'num'],
        ['chkRFactor', 'chk-r-factor', null, 'chk'],
        ['rValue', 'select-r-value', null, 'sel'],
        ['chkColdWork', 'chk-cold-work', null, 'chk'],
        ['chkInelasticReserve', 'chk-inelastic-reserve', null, 'chk'],
        // 웹 크리플링
        ['wcN', 'design-wc-N', 'length', 'num'],
        ['wcR', 'design-wc-R', 'length', 'num'],
        ['wcP', 'design-wc-P', 'force', 'num'],
        ['wcSupport', 'design-wc-support', null, 'sel'],
        ['wcFastened', 'design-wc-fastened', null, 'sel'],
        ['wcWebConfig', 'design-wc-web-config', null, 'sel'],
        ['wcFamily', 'design-wc-family', null, 'sel'],
        ['wcFlangeCondition', 'design-wc-flange-condition', null, 'sel'],
        ['wcLo', 'design-wc-Lo', 'length', 'num'],
        ['wcEdgeDistance', 'design-wc-edge-distance', 'length', 'num'],
        ['wcNWebs', 'design-wc-nwebs', null, 'num'],
        ['wcFastenerSpacing', 'design-wc-fastener-spacing', 'length', 'num'],
        // 템플릿
        ['templateType', 'select-template', null, 'sel'],
        ['tplH', 'tpl-H', 'length', 'num'],
        ['tplB', 'tpl-B', 'length', 'num'],
        ['tplD', 'tpl-D', 'length', 'num'],
        ['tplT', 'tpl-t', 'thickness', 'num'],
        ['tplR', 'tpl-r', 'radius', 'num'],
        ['tplQlip', 'tpl-qlip', null, 'num'],
        // 해석 탭
        ['analysisBC', 'select-bc', null, 'sel'],
        ['analysisLoadCase', 'select-load-case', null, 'sel'],
        ['analysisNeigs', 'input-neigs', null, 'num'],
        ['analysisLenMin', 'input-len-min', 'length', 'num'],
        ['analysisLenMax', 'input-len-max', 'length', 'num'],
        ['analysisLenN', 'input-len-n', null, 'num'],
        ['analysisLoadPUs', 'input-load-P', 'force', 'num'],
        ['analysisLoadMxxUs', 'input-load-Mxx', 'moment', 'num'],
        ['analysisLoadMzzUs', 'input-load-Mzz', 'moment', 'num'],
        ['chkCfsmEnable', 'chk-cfsm-enable', null, 'chk'],
        ['chkCfsmG', 'chk-cfsm-G', null, 'chk'],
        ['chkCfsmD', 'chk-cfsm-D', null, 'chk'],
        ['chkCfsmL', 'chk-cfsm-L', null, 'chk'],
        ['chkCfsmO', 'chk-cfsm-O', null, 'chk'],
        ['vibRho', 'vib-rho', 'density', 'num'],
        ['vibLengths', 'vib-lengths', 'length', 'list'],
        // 접합부 탭
        ['connFastenerType', 'conn-fastener-type', null, 'sel'],
        ['connSingleType', 'conn-single-type', null, 'sel'],
        ['connGrooveType', 'conn-groove-type', null, 'sel'],
        ['connLapLeft', 'conn-lap-left', 'length', 'num'],
        ['connLapRight', 'conn-lap-right', 'length', 'num'],
        ['connMu', 'conn-Mu', 'moment', 'num'],
        ['connVu', 'conn-Vu', 'force', 'num'],
        ['connFastenerDia', 'conn-fastener-dia', 'length', 'num'],
        ['connNRows', 'conn-n-rows', null, 'num'],
        ['connEdgeDist', 'conn-edge-dist', 'length', 'num'],
        ['connLapPnvs', 'conn-lap-Pnvs', 'force', 'num'],
        ['connT1', 'conn-t1', 'thickness', 'num'],
        ['connT2', 'conn-t2', 'thickness', 'num'],
        ['connD', 'conn-d', 'length', 'num'],
        ['connN', 'conn-n', null, 'num'],
        ['connFy', 'conn-Fy', 'stress', 'num'],
        ['connFu', 'conn-Fu', 'stress', 'num'],
        ['connWeldL', 'conn-weld-L', 'length', 'num'],
        ['connWeldSize', 'conn-weld-size', 'length', 'num'],
        ['connFub', 'conn-Fub', 'stress', 'num'],
        ['connFuf', 'conn-Fuf', 'stress', 'num'],
        ['connPnvs', 'conn-Pnvs', 'force', 'num'],
        ['connDw', 'conn-dw', 'length', 'num'],
        ['connPu', 'conn-Pu', 'force', 'num'],
        ['connTu', 'conn-Tu', 'force', 'num'],
        ['connE', 'conn-e', 'length', 'num'],
        ['connS', 'conn-s', 'length', 'num'],
        ['connMemberCase', 'conn-member-case', null, 'sel'],
        ['connWidth', 'conn-width', 'length', 'num'],
        ['connJ63NotApplicable', 'conn-j63-na', null, 'chk'],
    ];

    /**
     * V4-28: 바꿔도 설계 · 하중 결과를 지우지 않는 칸(그 결과를 만드는 데 쓰이지 않는다). [id, 까닭]
     * 이 밖의 칸(설계 · 하중 · 재료 · 단면 입력)은 바뀌면 결과를 지운다.
     */
    const VIEW_ONLY_CONTROLS = [
        ['select-length', '모드 형상 보기: 반파장 선택'],
        ['select-mode', '모드 형상 보기: 모드 번호 선택'],
        ['vib-rho', '진동 해석 입력 — 진동 결과에만 쓰임(설계 · 하중과 무관)'],
        ['vib-lengths', '진동 해석 입력 — 진동 결과에만 쓰임'],
        // 좌굴 해석 조건: 「해석 실행」 때 모델에 들어가고, 그때 호스트가 해석 · 설계 결과를 무효화한다 —
        // 칸을 바꾸는 순간에는 지금 결과가 아직 그 조건으로 만든 것이다.
        ['select-load-case', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-P', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-Mxx', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-load-Mzz', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['select-bc', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-min', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-max', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-len-n', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['input-neigs', '좌굴 해석 조건(해석 실행 때 적용)'],
        ['chk-cfsm-enable', '분류 표시 설정'],
        ['chk-cfsm-G', '분류 표시 설정'],
        ['chk-cfsm-D', '분류 표시 설정'],
        ['chk-cfsm-L', '분류 표시 설정'],
        ['chk-cfsm-O', '분류 표시 설정'],
    ];
    const _VIEW_ONLY_IDS = new Set(VIEW_ONLY_CONTROLS.map(x => x[0]));
    /** 이 칸의 변경이 결과를 지워야 하나(V4-28). */
    function invalidatesResults(id) { return !!id && !_VIEW_ONLY_IDS.has(String(id)); }

    /** 단위 전환용: { id: unitType } (단위 있는 칸만). */
    const UNIT_FIELDS = (function () {
        const out = {};
        FIELDS.forEach(([, id, unit]) => { if (unit) { out[id] = unit; } });
        return out;
    })();

    function _readRaw(document, id) {
        const el = document.getElementById(id);
        if (!el) { return undefined; }
        return el;
    }

    function collectDesignInputs(deps) {
        const { document, fromDisplay, getUnitSystem } = deps;
        const data = {};
        if (typeof getUnitSystem === 'function') {
            data.unitSystem = getUnitSystem();
        }
        data.analysisMethod = 'DSM'; // 해석법은 DSM 고정 (구 select-analysis-method 드롭다운 제거됨)
        for (const [key, id, unit, kind] of FIELDS) {
            const el = _readRaw(document, id);
            if (el === undefined) { continue; }
            if (kind === 'chk') { data[key] = !!el.checked; continue; }
            if (kind === 'sel') { data[key] = el.value; continue; }
            const raw = String(el.value == null ? '' : el.value).trim();
            if (kind === 'list') {
                data[key] = raw === '' ? null
                    : raw.split(/[,;\s]+/).filter(Boolean).map(Number)
                        .map(v => (isFinite(v) ? (unit ? fromDisplay(v, unit) : v) : NaN));
                continue;
            }
            if (raw === '') { data[key] = null; continue; }
            const v = parseFloat(raw);
            data[key] = !isFinite(v) ? null : (unit ? fromDisplay(v, unit) : v);
        }

        // 경간 · 지점 · 랩 표 (빈 칸은 null)
        const spanLens = [];
        const sups = [];
        const laps = [];
        const num = (el, unit) => {
            const raw = String(el && el.value != null ? el.value : '').trim();
            if (raw === '') { return null; }
            const v = parseFloat(raw);
            return isFinite(v) ? fromDisplay(v, unit) : null;
        };
        document.querySelectorAll('.span-tbl-len').forEach(el => { spanLens.push(num(el, 'length_ft')); });
        document.querySelectorAll('.span-tbl-sup').forEach(el => { sups.push(el.value); });
        for (let i = 0; i < sups.length; i++) {
            const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
            const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
            laps.push({ left: lEl ? num(lEl, 'length_ft') : null, right: rEl ? num(rEl, 'length_ft') : null });
        }
        data.spans = spanLens;
        data.supports = sups;
        data.lapsPerSupport = laps;
        return data;
    }

    function _applyValues(deps, data) {
        const { document, toDisplay } = deps;
        const setValue = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; } };
        for (const [key, id, unit, kind] of FIELDS) {
            if (!(key in data)) { continue; }
            const el = document.getElementById(id);
            if (!el) { continue; }
            const v = data[key];
            if (kind === 'chk') { if (v != null) { el.checked = !!v; } continue; }
            if (kind === 'sel') { if (v != null && v !== '') { el.value = v; } continue; }
            if (kind === 'list') {
                el.value = Array.isArray(v) && v.length > 0
                    ? v.map(x => String(Number((unit ? toDisplay(x, unit) : x).toPrecision(6)))).join(', ')
                    : '';
                continue;
            }
            if (v == null || !isFinite(v)) { el.value = ''; continue; }
            // 단위 전환(refreshUnits)과 같은 12 자리 — 부동소수 꼬리(118.11023622047244)를 보이지 않게
            el.value = unit ? String(Number(Number(toDisplay(v, unit)).toPrecision(12))) : v;
        }
        // 옛 파일(v1.0–1.2): custom 하중은 표시값으로만 있었다
        if (!('analysisLoadPUs' in data) && data.analysisLoadP != null) setValue('input-load-P', data.analysisLoadP);
        if (!('analysisLoadMxxUs' in data) && data.analysisLoadMxx != null) setValue('input-load-Mxx', data.analysisLoadMxx);
        if (!('analysisLoadMzzUs' in data) && data.analysisLoadMzz != null) setValue('input-load-Mzz', data.analysisLoadMzz);
    }

    function _fillSpans(deps, data) {
        const { document, toDisplay } = deps;
        const show = (el, v) => { if (el) { el.value = (v == null || !isFinite(v)) ? '' : toDisplay(v, 'length_ft'); } };
        if (data.spans) {
            document.querySelectorAll('.span-tbl-len').forEach((el, i) => {
                if (i < data.spans.length) show(el, data.spans[i]);
            });
        }
        if (data.supports) {
            document.querySelectorAll('.span-tbl-sup').forEach((el, i) => {
                if (data.supports[i]) el.value = data.supports[i];
            });
        }
        if (data.lapsPerSupport) {
            data.lapsPerSupport.forEach((lap, i) => {
                const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
                const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
                if (lap && 'left' in lap) show(lEl, lap.left);
                if (lap && 'right' in lap) show(rEl, lap.right);
            });
        }
    }

    /**
     * 복원. deps.initialInputs(화면을 처음 열었을 때 collectDesignInputs 한 값)가 있으면 먼저 모든 칸을 그 값으로
     * 되돌린 뒤 파일 값을 얹는다 — 파일에 없는 칸이 이전 프로젝트 값을 지니지 않게(V4-10).
     * 빈 칸(null)은 빈 칸으로 돌아온다(V4-07).
     */
    function restoreDesignInputs(deps, data) {
        if (!data) {
            return;
        }
        const { document, toDisplay, buildSpanTable, setTimeoutFn, updateAnalysisFyDisplay, setUnitSystem } = deps;

        // 단위 시스템 복원 (다른 값 복원 전에 먼저 설정)
        if (data.unitSystem && typeof setUnitSystem === 'function') {
            setUnitSystem(data.unitSystem);
        }
        if (deps.initialInputs && typeof deps.initialInputs === 'object') {
            const init = { ...deps.initialInputs };
            delete init.unitSystem;
            _applyValues(deps, init);
        }
        _applyValues(deps, data);

        // 강종 Fy · Fu 단일 소스: 설계 Fy 가 있으면 전처리 · 소성 칸도 같은 값(옛 파일 호환)
        const setValue = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; } };
        if (data.fu != null && !('fuPre' in data)) {
            setValue('input-fu', toDisplay(data.fu, 'stress'));
        }
        const restoredFy = data.fy != null
            ? toDisplay(data.fy, 'stress')
            : data.fyLoad != null
                ? toDisplay(data.fyLoad, 'stress')
                : null;
        if (restoredFy != null) {
            setValue('input-fy', restoredFy);
            setValue('plastic-fy', restoredFy);
            setValue('design-fy', restoredFy);
            if (typeof updateAnalysisFyDisplay === 'function') {
                updateAnalysisFyDisplay(restoredFy);
            }
        } else if (typeof updateAnalysisFyDisplay === 'function') {
            // 처음 값으로 되돌린 Fy 를 해석 탭 표시에도(입력 기록이 없는 파일 — V4-10)
            const fyEl = document.getElementById('input-fy');
            if (fyEl) { updateAnalysisFyDisplay(fyEl.value); }
        }

        if (typeof buildSpanTable === 'function') {
            // buildSpanTable 은 동기 함수다 — 표가 이미 만들어졌으므로 곧바로 채운다(전: 100 ms 타이머).
            buildSpanTable();
            _fillSpans(deps, data);
        } else {
            (typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout)(() => _fillSpans(deps, data), 0);
        }

        // 값만 바꾸면 화면의 연동(필드 표시, PLF, β, custom 하중 칸, 접합 유형 칸)이 갱신되지 않는다 — 호출자가 돌린다.
        if (typeof deps.afterRestore === 'function') {
            deps.afterRestore();
        }
    }

    // Lap 접합부 지배값 선택 (순수함수 — app.js _autoFillLapInputs와 node 테스트 공용).
    // locations[].Mu는 kip-ft. 'Lap end' 위치와 정모멘트(Mu>0)를 제외하고
    // 지점 부모멘트(Mu<0) 중 최대 |Mu|를 선택한다(§4 이슈2A 회귀 고정).
    // Vu는 위치 무관 최대 |Vu|.
    // 반환: { negMuFt: number|null(부모멘트 원값, kip-ft), maxVu: number,
    //         negMuName: string|null }
    function selectLapGoverningMoment(locations) {
        let maxNegMu = 0;
        let maxVu = 0;
        let negMuName = null;
        (locations || []).forEach(function (loc) {
            if (!loc) return;
            if ((loc.name || '').indexOf('Lap end') === 0) return;
            if (loc.Mu != null && loc.Mu < 0 && Math.abs(loc.Mu) > Math.abs(maxNegMu)) {
                maxNegMu = loc.Mu;
                negMuName = loc.name || null;
            }
            if (loc.Vu != null && Math.abs(loc.Vu) > maxVu) maxVu = Math.abs(loc.Vu);
        });
        return {
            negMuFt: maxNegMu !== 0 ? maxNegMu : null,
            maxVu: maxVu,
            negMuName: negMuName,
        };
    }

    return {
        FIELDS,
        UNIT_FIELDS,
        VIEW_ONLY_CONTROLS,
        invalidatesResults,
        collectDesignInputs,
        restoreDesignInputs,
        selectLapGoverningMoment,
    };
});
