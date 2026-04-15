(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdDesignState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function collectDesignInputs(deps) {
        const { document, fromDisplay, getNum, getUnitSystem } = deps;
        const data = {};

        // 단위 시스템
        if (typeof getUnitSystem === 'function') {
            data.unitSystem = getUnitSystem();
        }

        data.steelGrade = document.getElementById('select-steel-grade')?.value || 'custom';
        data.fy = fromDisplay(getNum('design-fy', 35.53), 'stress');
        data.fu = fromDisplay(getNum('design-fu', 58.02), 'stress');

        data.designMethod = document.getElementById('select-design-method')?.value || 'LRFD';
        data.analysisMethod = document.getElementById('select-analysis-method')?.value || 'DSM';
        data.memberType = document.getElementById('select-member-type')?.value || 'flexure';

        data.spanType = document.getElementById('select-span-type')?.value || 'simple';
        data.nSpans = getNum('config-n-spans', 5);
        data.spacing = fromDisplay(getNum('config-spacing', 3.281), 'length_ft');

        const spanLens = [];
        const sups = [];
        const laps = [];
        document.querySelectorAll('.span-tbl-len').forEach(el => {
            spanLens.push(fromDisplay(parseFloat(el.value) || 25, 'length_ft'));
        });
        document.querySelectorAll('.span-tbl-sup').forEach(el => {
            sups.push(el.value);
        });
        for (let i = 0; i < sups.length; i++) {
            const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
            const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
            laps.push({
                left: lEl ? fromDisplay(parseFloat(lEl.value) || 0, 'length_ft') : 0,
                right: rEl ? fromDisplay(parseFloat(rEl.value) || 0, 'length_ft') : 0,
            });
        }
        data.spans = spanLens;
        data.supports = sups;
        data.lapsPerSupport = laps;

        data.loadD = fromDisplay(getNum('load-D-psf', 0), 'pressure');
        data.loadLr = fromDisplay(getNum('load-Lr-psf', 0), 'pressure');
        data.loadS = fromDisplay(getNum('load-S-psf', 0), 'pressure');
        data.loadWu = fromDisplay(getNum('load-Wu-psf', 0), 'pressure');
        data.loadWp = fromDisplay(getNum('load-Wp-psf', 0), 'pressure');
        data.loadL = fromDisplay(getNum('load-L-psf', 0), 'pressure');

        data.deckType = document.getElementById('select-deck-type')?.value || 'none';
        data.deckTPanel = fromDisplay(getNum('deck-t-panel', 0.0197), 'thickness');
        data.deckFastenerSpacing = fromDisplay(getNum('deck-fastener-spacing', 11.81), 'length');
        const deckKphiOverrideEl = document.getElementById('deck-kphi-override');
        data.deckKphiOverride = deckKphiOverrideEl && deckKphiOverrideEl.value.trim() !== ''
            ? fromDisplay(parseFloat(deckKphiOverrideEl.value), 'rotStiff')
            : null;

        data.KxLx = fromDisplay(getNum('design-KxLx', 118.11), 'length');
        data.KyLy = fromDisplay(getNum('design-KyLy', 118.11), 'length');
        data.KtLt = fromDisplay(getNum('design-KtLt', 118.11), 'length');
        data.Lb = fromDisplay(getNum('design-Lb', 118.11), 'length');
        data.Cb = getNum('design-Cb', 1.0);
        data.Cmx = getNum('design-Cmx', 0.85);
        data.Cmy = getNum('design-Cmy', 0.85);

        data.Pu = fromDisplay(getNum('design-P', 0), 'force');
        data.Vu = fromDisplay(getNum('design-V', 0), 'force');
        data.Mux = fromDisplay(getNum('design-Mx', 0), 'moment');
        data.Muy = fromDisplay(getNum('design-My', 0), 'moment');
        data.MayStrength = fromDisplay(getNum('design-May-strength', 0), 'moment');

        data.wcN = fromDisplay(getNum('design-wc-N', 3.504), 'length');
        data.wcR = fromDisplay(getNum('design-wc-R', 0.1875), 'radius');
        data.wcSupport = document.getElementById('design-wc-support')?.value || 'EOF';
        data.wcFastened = document.getElementById('design-wc-fastened')?.value || 'fastened';
        data.wcWebConfig = document.getElementById('design-wc-web-config')?.value || 'single';
        data.wcFamily = document.getElementById('design-wc-family')?.value || 'auto';
        data.wcFlangeCondition = document.getElementById('design-wc-flange-condition')?.value || 'stiffened';
        data.wcLo = fromDisplay(getNum('design-wc-Lo', 0), 'length');
        data.wcEdgeDistance = fromDisplay(getNum('design-wc-edge-distance', 0), 'length');
        data.wcNWebs = getNum('design-wc-nwebs', 1);
        data.wcFastenerSpacing = fromDisplay(getNum('design-wc-fastener-spacing', 0), 'length');

        data.templateType = document.getElementById('select-template')?.value || '';
        data.tplH = fromDisplay(getNum('tpl-H', 7.874), 'length');
        data.tplB = fromDisplay(getNum('tpl-B', 2.953), 'length');
        data.tplD = fromDisplay(getNum('tpl-D', 0.787), 'length');
        data.tplT = fromDisplay(getNum('tpl-t', 0.0906), 'thickness');
        data.tplR = fromDisplay(getNum('tpl-r', 0.157), 'radius');
        data.tplQlip = getNum('tpl-qlip', 90);

        data.fyLoad = fromDisplay(getNum('input-fy', 35.53), 'stress');

        // 해석 탭 설정
        data.analysisBC = document.getElementById('select-bc')?.value || 'S-S';
        data.analysisLoadCase = document.getElementById('select-load-case')?.value || 'compression';
        data.analysisNeigs = getNum('input-neigs', 10);
        data.analysisLenMin = fromDisplay(getNum('input-len-min', 10), 'length');
        data.analysisLenMax = fromDisplay(getNum('input-len-max', 10000), 'length');
        data.analysisLenN = getNum('input-len-n', 60);
        data.analysisLoadP = getNum('input-load-P', 0);
        data.analysisLoadMxx = getNum('input-load-Mxx', 0);
        data.analysisLoadMzz = getNum('input-load-Mzz', 0);

        // 체크박스 옵션
        data.chkColdWork = !!document.getElementById('chk-cold-work')?.checked;
        data.chkInelasticReserve = !!document.getElementById('chk-inelastic-reserve')?.checked;
        data.chkBetaDist = !!document.getElementById('chk-beta-dist')?.checked;
        data.chkRFactor = !!document.getElementById('chk-r-factor')?.checked;
        data.chkCfsmEnable = !!document.getElementById('chk-cfsm-enable')?.checked;
        data.chkCfsmG = !!document.getElementById('chk-cfsm-G')?.checked;
        data.chkCfsmD = !!document.getElementById('chk-cfsm-D')?.checked;
        data.chkCfsmL = !!document.getElementById('chk-cfsm-L')?.checked;
        data.chkCfsmO = !!document.getElementById('chk-cfsm-O')?.checked;

        // 전처리 강종 선택
        data.presteelGrade = document.getElementById('input-steel-grade')?.value || '';

        // 접합부 탭 입력값
        data.connFastenerType = document.getElementById('conn-fastener-type')?.value || 'screw';
        data.connSingleType = document.getElementById('conn-single-type')?.value || 'shear';
        data.connGrooveType = document.getElementById('conn-groove-type')?.value || 'flare-bevel';
        data.connLapLeft = fromDisplay(getNum('conn-lap-left', 0), 'length');
        data.connLapRight = fromDisplay(getNum('conn-lap-right', 0), 'length');
        data.connT1 = fromDisplay(getNum('conn-t1', 0), 'thickness');
        data.connT2 = fromDisplay(getNum('conn-t2', 0), 'thickness');
        data.connD = fromDisplay(getNum('conn-d', 0), 'length');
        data.connFy = fromDisplay(getNum('conn-Fy', 0), 'stress');
        data.connFu = fromDisplay(getNum('conn-Fu', 0), 'stress');
        data.connFub = fromDisplay(getNum('conn-Fub', 0), 'stress');
        data.connFuf = fromDisplay(getNum('conn-Fuf', 0), 'stress');
        data.connPu = fromDisplay(getNum('conn-Pu', 0), 'force');
        data.connMu = fromDisplay(getNum('conn-Mu', 0), 'moment');
        data.connVu = fromDisplay(getNum('conn-Vu', 0), 'force');
        data.connWeldL = fromDisplay(getNum('conn-weld-L', 0), 'length');
        data.connWeldSize = fromDisplay(getNum('conn-weld-size', 0), 'length');
        data.connFastenerDia = fromDisplay(getNum('conn-fastener-dia', 0), 'length');
        data.connNRows = getNum('conn-n-rows', 1);
        data.connN = getNum('conn-n', 4);

        return data;
    }

    function restoreDesignInputs(deps, data) {
        if (!data) {
            return;
        }
        const {
            document,
            toDisplay,
            buildSpanTable,
            setTimeoutFn,
            updateAnalysisFyDisplay,
            setUnitSystem,
        } = deps;

        // 단위 시스템 복원 (다른 값 복원 전에 먼저 설정)
        if (data.unitSystem && typeof setUnitSystem === 'function') {
            setUnitSystem(data.unitSystem);
        }

        function setValue(id, val) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
            }
        }

        function setSelect(id, val) {
            const el = document.getElementById(id);
            if (el) {
                el.value = val;
            }
        }

        if (data.steelGrade) setSelect('select-steel-grade', data.steelGrade);
        if (data.fy != null) setValue('design-fy', toDisplay(data.fy, 'stress'));
        if (data.fu != null) {
            const fuDisplay = toDisplay(data.fu, 'stress');
            setValue('design-fu', fuDisplay);
            setValue('input-fu', fuDisplay);
        }

        if (data.designMethod) setSelect('select-design-method', data.designMethod);
        if (data.analysisMethod) setSelect('select-analysis-method', data.analysisMethod);
        if (data.memberType) setSelect('select-member-type', data.memberType);

        if (data.spanType) {
            setSelect('select-span-type', data.spanType);
            if (data.nSpans != null) setValue('config-n-spans', data.nSpans);
        }
        if (data.spacing != null) setValue('config-spacing', toDisplay(data.spacing, 'length_ft'));

        if (typeof buildSpanTable === 'function') {
            buildSpanTable();
        }
        const defer = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
        defer(() => {
            if (data.spans) {
                document.querySelectorAll('.span-tbl-len').forEach((el, i) => {
                    if (data.spans[i] != null) el.value = toDisplay(data.spans[i], 'length_ft');
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
                    if (lEl && lap.left != null) lEl.value = toDisplay(lap.left, 'length_ft');
                    if (rEl && lap.right != null) rEl.value = toDisplay(lap.right, 'length_ft');
                });
            }
        }, 100);

        if (data.loadD != null) setValue('load-D-psf', toDisplay(data.loadD, 'pressure'));
        if (data.loadLr != null) setValue('load-Lr-psf', toDisplay(data.loadLr, 'pressure'));
        if (data.loadS != null) setValue('load-S-psf', toDisplay(data.loadS, 'pressure'));
        if (data.loadWu != null) setValue('load-Wu-psf', toDisplay(data.loadWu, 'pressure'));
        if (data.loadWp != null) setValue('load-Wp-psf', toDisplay(data.loadWp, 'pressure'));
        if (data.loadL != null) setValue('load-L-psf', toDisplay(data.loadL, 'pressure'));

        if (data.deckType) setSelect('select-deck-type', data.deckType);
        if (data.deckTPanel != null) setValue('deck-t-panel', toDisplay(data.deckTPanel, 'thickness'));
        if (data.deckFastenerSpacing != null) setValue('deck-fastener-spacing', toDisplay(data.deckFastenerSpacing, 'length'));
        if (data.deckKphiOverride != null) setValue('deck-kphi-override', toDisplay(data.deckKphiOverride, 'rotStiff'));
        else setValue('deck-kphi-override', '');

        if (data.KxLx != null) setValue('design-KxLx', toDisplay(data.KxLx, 'length'));
        if (data.KyLy != null) setValue('design-KyLy', toDisplay(data.KyLy, 'length'));
        if (data.KtLt != null) setValue('design-KtLt', toDisplay(data.KtLt, 'length'));
        if (data.Lb != null) setValue('design-Lb', toDisplay(data.Lb, 'length'));
        if (data.Cb != null) setValue('design-Cb', data.Cb);
        if (data.Cmx != null) setValue('design-Cmx', data.Cmx);
        if (data.Cmy != null) setValue('design-Cmy', data.Cmy);

        if (data.Pu != null) setValue('design-P', toDisplay(data.Pu, 'force'));
        if (data.Vu != null) setValue('design-V', toDisplay(data.Vu, 'force'));
        if (data.Mux != null) setValue('design-Mx', toDisplay(data.Mux, 'moment'));
        if (data.Muy != null) setValue('design-My', toDisplay(data.Muy, 'moment'));
        if (data.MayStrength != null) setValue('design-May-strength', toDisplay(data.MayStrength, 'moment'));

        if (data.wcN != null) setValue('design-wc-N', toDisplay(data.wcN, 'length'));
        if (data.wcR != null) setValue('design-wc-R', toDisplay(data.wcR, 'radius'));
        if (data.wcSupport) setSelect('design-wc-support', data.wcSupport);
        if (data.wcFastened) setSelect('design-wc-fastened', data.wcFastened);
        if (data.wcWebConfig) setSelect('design-wc-web-config', data.wcWebConfig);
        if (data.wcFamily) setSelect('design-wc-family', data.wcFamily);
        if (data.wcFlangeCondition) setSelect('design-wc-flange-condition', data.wcFlangeCondition);
        if (data.wcLo != null) setValue('design-wc-Lo', toDisplay(data.wcLo, 'length'));
        if (data.wcEdgeDistance != null) setValue('design-wc-edge-distance', toDisplay(data.wcEdgeDistance, 'length'));
        if (data.wcNWebs != null) setValue('design-wc-nwebs', data.wcNWebs);
        if (data.wcFastenerSpacing != null) setValue('design-wc-fastener-spacing', toDisplay(data.wcFastenerSpacing, 'length'));

        if (data.templateType) setSelect('select-template', data.templateType);
        if (data.tplH != null) setValue('tpl-H', toDisplay(data.tplH, 'length'));
        if (data.tplB != null) setValue('tpl-B', toDisplay(data.tplB, 'length'));
        if (data.tplD != null) setValue('tpl-D', toDisplay(data.tplD, 'length'));
        if (data.tplT != null) setValue('tpl-t', toDisplay(data.tplT, 'thickness'));
        if (data.tplR != null) setValue('tpl-r', toDisplay(data.tplR, 'radius'));
        if (data.tplQlip != null) setValue('tpl-qlip', data.tplQlip);

        if (data.fyLoad != null) {
            const fyDisplay = toDisplay(data.fyLoad, 'stress');
            setValue('input-fy', fyDisplay);
            setValue('plastic-fy', fyDisplay);
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
        }

        // 해석 탭 설정 복원
        if (data.analysisBC) setSelect('select-bc', data.analysisBC);
        if (data.analysisLoadCase) setSelect('select-load-case', data.analysisLoadCase);
        if (data.analysisNeigs != null) setValue('input-neigs', data.analysisNeigs);
        if (data.analysisLenMin != null) setValue('input-len-min', toDisplay(data.analysisLenMin, 'length'));
        if (data.analysisLenMax != null) setValue('input-len-max', toDisplay(data.analysisLenMax, 'length'));
        if (data.analysisLenN != null) setValue('input-len-n', data.analysisLenN);
        if (data.analysisLoadP != null) setValue('input-load-P', data.analysisLoadP);
        if (data.analysisLoadMxx != null) setValue('input-load-Mxx', data.analysisLoadMxx);
        if (data.analysisLoadMzz != null) setValue('input-load-Mzz', data.analysisLoadMzz);

        // 체크박스 옵션 복원
        const chkCW = document.getElementById('chk-cold-work');
        if (chkCW && data.chkColdWork != null) chkCW.checked = data.chkColdWork;
        const chkIR = document.getElementById('chk-inelastic-reserve');
        if (chkIR && data.chkInelasticReserve != null) chkIR.checked = data.chkInelasticReserve;
        const chkBD = document.getElementById('chk-beta-dist');
        if (chkBD && data.chkBetaDist != null) chkBD.checked = data.chkBetaDist;
        const chkRF = document.getElementById('chk-r-factor');
        if (chkRF && data.chkRFactor != null) chkRF.checked = data.chkRFactor;
        const chkCE = document.getElementById('chk-cfsm-enable');
        if (chkCE && data.chkCfsmEnable != null) chkCE.checked = data.chkCfsmEnable;
        const chkCG = document.getElementById('chk-cfsm-G');
        if (chkCG && data.chkCfsmG != null) chkCG.checked = data.chkCfsmG;
        const chkCD = document.getElementById('chk-cfsm-D');
        if (chkCD && data.chkCfsmD != null) chkCD.checked = data.chkCfsmD;
        const chkCL = document.getElementById('chk-cfsm-L');
        if (chkCL && data.chkCfsmL != null) chkCL.checked = data.chkCfsmL;
        const chkCO = document.getElementById('chk-cfsm-O');
        if (chkCO && data.chkCfsmO != null) chkCO.checked = data.chkCfsmO;

        // 전처리 강종 선택 복원
        if (data.presteelGrade) setSelect('input-steel-grade', data.presteelGrade);

        // 접합부 탭 입력값 복원
        if (data.connFastenerType) setSelect('conn-fastener-type', data.connFastenerType);
        if (data.connSingleType) setSelect('conn-single-type', data.connSingleType);
        if (data.connGrooveType) setSelect('conn-groove-type', data.connGrooveType);
        if (data.connLapLeft != null) setValue('conn-lap-left', toDisplay(data.connLapLeft, 'length'));
        if (data.connLapRight != null) setValue('conn-lap-right', toDisplay(data.connLapRight, 'length'));
        if (data.connT1 != null) setValue('conn-t1', toDisplay(data.connT1, 'thickness'));
        if (data.connT2 != null) setValue('conn-t2', toDisplay(data.connT2, 'thickness'));
        if (data.connD != null) setValue('conn-d', toDisplay(data.connD, 'length'));
        if (data.connFy != null) setValue('conn-Fy', toDisplay(data.connFy, 'stress'));
        if (data.connFu != null) setValue('conn-Fu', toDisplay(data.connFu, 'stress'));
        if (data.connFub != null) setValue('conn-Fub', toDisplay(data.connFub, 'stress'));
        if (data.connFuf != null) setValue('conn-Fuf', toDisplay(data.connFuf, 'stress'));
        if (data.connPu != null) setValue('conn-Pu', toDisplay(data.connPu, 'force'));
        if (data.connMu != null) setValue('conn-Mu', toDisplay(data.connMu, 'moment'));
        if (data.connVu != null) setValue('conn-Vu', toDisplay(data.connVu, 'force'));
        if (data.connWeldL != null) setValue('conn-weld-L', toDisplay(data.connWeldL, 'length'));
        if (data.connWeldSize != null) setValue('conn-weld-size', toDisplay(data.connWeldSize, 'length'));
        if (data.connFastenerDia != null) setValue('conn-fastener-dia', toDisplay(data.connFastenerDia, 'length'));
        if (data.connNRows != null) setValue('conn-n-rows', data.connNRows);
        if (data.connN != null) setValue('conn-n', data.connN);
    }

    return {
        collectDesignInputs,
        restoreDesignInputs,
    };
});
