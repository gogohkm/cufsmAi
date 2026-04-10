(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdDesignState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    function collectDesignInputs(deps) {
        const { document, fromDisplay, getNum } = deps;
        const data = {};

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
        } = deps;

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
    }

    return {
        collectDesignInputs,
        restoreDesignInputs,
    };
});
