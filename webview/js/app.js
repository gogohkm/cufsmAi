/**
 * CUFSM WebView 앱 — 메인 진입점
 *
 * 참조: 컨버전전략.md §3 데이터 흐름
 * Extension Host ↔ WebView postMessage 통신
 */

// @ts-check
(function () {
    // VS Code API
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    /** 현재 모델 */
    let model = null;
    /** 해석 결과 */
    let analysisResult = null;
    /** DSM 결과 (극점 표시용) */
    let lastDsmResult = null;
    /** 설계 결과 (Report용) */
    let _lastDesignResult = null;
    /** 단면 성질 (Report용) */
    let lastProps = null;
    /** 하중 분석 결과 */
    let _lastLoadAnalysis = null;

    // ============================================================
    // 단위 변환 시스템 (SI ↔ US)
    // 내부 저장: 항상 US 단위. 표시/입력 레이어에서만 변환.
    // ============================================================
    let _unitSystem = 'SI'; // 'US' or 'SI'

    const UNIT = {
        // 변환 계수: US값 × factor = SI값
        length:   { factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 1} },
        length_ft:{ factor: 0.3048,    us: 'ft',    si: 'm',    decimals: {us: 2, si: 2} },
        area:     { factor: 645.16,    us: 'in\u00B2',  si: 'mm\u00B2', decimals: {us: 4, si: 0} },
        inertia:  { factor: 416231.0,  us: 'in\u2074',  si: 'mm\u2074', decimals: {us: 4, si: 0} },
        modulus:  { factor: 16387.064, us: 'in\u00B3',  si: 'mm\u00B3', decimals: {us: 4, si: 0} },
        stress:   { factor: 6.89476,   us: 'ksi',   si: 'MPa',  decimals: {us: 1, si: 1} },
        force:    { factor: 4.44822,   us: 'kips',  si: 'kN',   decimals: {us: 2, si: 2} },
        moment:   { factor: 0.11298,   us: 'kip-in',si: 'kN-m', decimals: {us: 2, si: 2} },
        moment_ft:{ factor: 1.35582,   us: 'kip-ft',si: 'kN-m', decimals: {us: 2, si: 2} },
        pressure: { factor: 0.04788,   us: 'psf',   si: 'kPa',  decimals: {us: 1, si: 3} },
        linload:  { factor: 0.01459,   us: 'plf',   si: 'kN/m', decimals: {us: 0, si: 3} },
        thickness:{ factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 2} },
        radius:   { factor: 25.4,      us: 'in',    si: 'mm',   decimals: {us: 4, si: 1} },
        rotStiff: { factor: 0.004448/0.0254, us: 'k-in/rad/in', si: 'kN-m/rad/m', decimals: {us: 4, si: 4} },
    };

    /** US 내부값 → 표시값 변환 */
    function toDisplay(usValue, unitType) {
        if (_unitSystem === 'US' || !UNIT[unitType]) return usValue;
        return usValue * UNIT[unitType].factor;
    }
    /** 표시값 → US 내부값 변환 */
    function fromDisplay(displayValue, unitType) {
        if (_unitSystem === 'US' || !UNIT[unitType]) return displayValue;
        return displayValue / UNIT[unitType].factor;
    }
    /** 현재 단위계의 단위 라벨 반환 */
    function unitLabel(unitType) {
        const u = UNIT[unitType];
        if (!u) return '';
        return _unitSystem === 'SI' ? u.si : u.us;
    }
    /** 현재 단위계의 소수점 자릿수 */
    function unitDec(unitType) {
        const u = UNIT[unitType];
        if (!u) return 2;
        return _unitSystem === 'SI' ? u.decimals.si : u.decimals.us;
    }
    /** 값을 표시 형식으로 변환 + 포맷 */
    function fmtVal(usValue, unitType) {
        if (usValue == null || isNaN(usValue)) return '\u2014';
        const v = toDisplay(usValue, unitType);
        return v.toFixed(unitDec(unitType));
    }

    /** 단위 토글 시 모든 동적 라벨/값 갱신
     *  oldSys → newSys: 입력 필드의 값을 변환해야 함.
     *  공식: newDisplayVal = usVal * newFactor = (oldDisplayVal / oldFactor) * newFactor
     */
    function refreshUnits(oldSys) {
        // (0) 입력 필드 값 변환 (data-unit-input 매핑)
        const inputUnitMap = [
            // [inputId, unitType]
            ['tpl-H','length'],['tpl-B','length'],['tpl-D','length'],
            ['tpl-t','thickness'],['tpl-r','radius'],
            ['input-E','stress'],['input-G','stress'],
            ['input-fy-load','stress'],['input-fy','stress'],
            ['input-len-min','length'],['input-len-max','length'],
            ['design-fy','stress'],['design-fu','stress'],
            ['design-KxLx','length'],['design-KyLy','length'],
            ['design-KtLt','length'],['design-Lb','length'],
            ['design-P','force'],['design-V','force'],
            ['design-Mx','moment'],['design-My','moment'],
            ['design-wc-N','length'],['design-wc-R','radius'],
            ['config-spacing','length_ft'],
            ['deck-t-panel','thickness'],['deck-fastener-spacing','length'],
            ['load-D-psf','pressure'],['load-Lr-psf','pressure'],
            ['load-S-psf','pressure'],['load-Wu-psf','pressure'],
            ['load-L-psf','pressure'],
        ];
        // span/lap 테이블 동적 입력
        document.querySelectorAll('.span-tbl-len, .span-tbl-lapl, .span-tbl-lapr').forEach(el => {
            inputUnitMap.push([null, 'length_ft', el]);
        });

        if (oldSys && oldSys !== _unitSystem) {
            inputUnitMap.forEach(([id, ut, directEl]) => {
                const el = directEl || document.getElementById(id);
                if (!el) return;
                const oldVal = parseFloat(el.value);
                if (isNaN(oldVal) || oldVal === 0) return;
                const oldFactor = oldSys === 'SI' ? UNIT[ut].factor : 1.0;
                const newFactor = _unitSystem === 'SI' ? UNIT[ut].factor : 1.0;
                const usVal = oldVal / oldFactor;
                const newVal = usVal * newFactor;
                el.value = newVal.toPrecision(6).replace(/\.?0+$/, '');
            });
        }

        // (1) 모든 data-unit 속성을 가진 라벨 텍스트 갱신
        document.querySelectorAll('[data-unit]').forEach(el => {
            if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return; // 입력 필드 제외
            const ut = el.getAttribute('data-unit');
            el.textContent = unitLabel(ut);
        });
        // (2) 단면 성질 테이블이 표시 중이면 다시 렌더링
        if (lastProps) updatePropertiesTable(lastProps);
        // (3) 하중 해석 결과가 있으면 다시 렌더링
        if (_lastLoadAnalysis) renderLoadAnalysisResult(_lastLoadAnalysis);
        // (4) PLF 표시 갱신
        if (typeof updatePLF === 'function') updatePLF();
    }

    // ============================================================
    // 메시지 핸들러
    // ============================================================
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'modelLoaded':
                model = msg.data;
                renderPreprocessor();
                renderStressPreview();
                sendTreeUpdate();
                break;
            case 'analysisStarted':
                setStatus('Running analysis...', 'running');
                break;
            case 'analysisComplete':
                analysisResult = msg.data;
                // curve 데이터 정규화: [[10, 0.05, ...]] → [10, 0.05, ...]
                if (analysisResult && analysisResult.curve) {
                    analysisResult.curve = analysisResult.curve.map(row => {
                        if (Array.isArray(row) && row.length === 1 && Array.isArray(row[0])) {
                            return row[0]; // 이중 배열 풀기
                        }
                        return row;
                    });
                }
                setStatus(`Analysis complete — ${analysisResult.n_lengths} lengths`, 'success');
                renderBucklingCurve();
                populatePostSelects();
                renderModeShape2D();
                renderModeShape3DWrapper();
                switchTab('postprocessor');
                break;
            case 'propertiesResult':
                renderProperties(msg.data);
                sendTreeUpdate();
                break;
            case 'templateGenerated':
                if (model && msg.data) {
                    model.node = msg.data.node;
                    model.elem = msg.data.elem;
                    // 균일 응력 기본값
                    if (model.node) {
                        model.node.forEach(n => { if (n[7] === 1) { n[7] = 50.0; } });
                    }
                    renderPreprocessor();
                    renderStressPreview();
                    setStatus(`Template generated: ${model.node.length} nodes, ${model.elem.length} elements`, 'success');
                    sendTreeUpdate();
                }
                break;
            case 'templateError':
                setStatus('Template error: ' + (msg.data && msg.data.error || 'Unknown'), 'error');
                console.error('[CUFSM] templateError:', msg.data);
                break;
            case 'analysisError':
                setStatus('Analysis error: ' + (msg.data && msg.data.error || 'Unknown'), 'error');
                console.error('[CUFSM] analysisError:', msg.data);
                break;
            case 'stressError':
                console.error('[CUFSM] stressError:', msg.data);
                break;
            case 'plasticError':
                console.error('[CUFSM] plasticError:', msg.data);
                break;
            case 'classifyError':
                console.error('[CUFSM] classifyError:', msg.data);
                break;
            case 'stressApplied':
                if (model && msg.data && msg.data.node) {
                    model.node = msg.data.node;
                    renderNodeTable();
                }
                break;
            case 'showSection':
                if (msg.data && msg.data.sectionId) {
                    handleShowSection(msg.data.sectionId);
                }
                break;
            case 'classifyResult':
                renderClassifyCurve(msg.data);
                break;
            case 'plasticResult':
                renderPlasticSurface(msg.data);
                break;
            case 'dsmResult':
                lastDsmResult = msg.data;
                renderDsmResults(msg.data);
                renderBucklingCurve(); // DSM 극점 표시를 위해 다시 그리기
                sendTreeUpdate();
                break;
            case 'designResult':
                _lastDesignResult = msg.data;
                renderDesignResult(msg.data);
                sendTreeUpdate();
                break;
            case 'captureSection':
                captureSectionPreview();
                break;
            case 'loadAnalysisComplete':
                renderLoadAnalysisResult(msg.data);
                sendTreeUpdate();
                break;
            case 'collectDesignData':
                vscode.postMessage({ command: 'designDataCollected', data: collectAllDesignInputs() });
                break;
            case 'restoreDesignInputs':
                restoreAllDesignInputs(msg.data);
                break;
        }
    });

    // ============================================================
    // 탭 전환
    // ============================================================
    document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.getAttribute('data-tab'));
        });
    });

    function switchTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        const panel = document.getElementById(`tab-${tabId}`);
        if (btn) { btn.classList.add('active'); }
        if (panel) { panel.classList.add('active'); }
    }

    // ============================================================
    // 단위 토글 (SI ↔ US)
    // ============================================================
    document.getElementById('btn-unit-US')?.addEventListener('click', () => {
        if (_unitSystem === 'US') return;
        const oldSys = _unitSystem;
        _unitSystem = 'US';
        document.getElementById('btn-unit-US')?.classList.add('active');
        document.getElementById('btn-unit-SI')?.classList.remove('active');
        refreshUnits(oldSys);
    });
    document.getElementById('btn-unit-SI')?.addEventListener('click', () => {
        if (_unitSystem === 'SI') return;
        const oldSys = _unitSystem;
        _unitSystem = 'SI';
        document.getElementById('btn-unit-SI')?.classList.add('active');
        document.getElementById('btn-unit-US')?.classList.remove('active');
        refreshUnits(oldSys);
    });

    // 기본 SI ���위계 초기화: 입력 필드 값을 SI로 변환
    if (_unitSystem === 'SI') {
        refreshUnits('US');
    }

    // ============================================================
    // 전처리 렌더링
    // ============================================================
    function renderPreprocessor() {
        if (!model) { return; }
        renderNodeTable();
        renderElemTable();
        renderSectionSVG();

        // 재료 입력 초기값 (US 내부값 → 표시값 변환)
        if (model.prop && model.prop.length > 0) {
            const p = model.prop[0];
            setValue('input-E', toDisplay(p[1], 'stress'));
            setValue('input-v', p[3]);
            setValue('input-G', toDisplay(p[5], 'stress'));
        }

        // 단면 속성 자동 계산
        if (model.node && model.node.length > 0) {
            vscode.postMessage({ command: 'getProperties', data: { node: model.node, elem: model.elem } });
        }
    }

    function renderNodeTable() {
        const tbody = document.querySelector('#node-table tbody');
        if (!tbody || !model) { return; }
        tbody.innerHTML = '';
        model.node.forEach((n, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td><input type="number" value="${n[1]}" step="0.1" data-row="${i}" data-col="1"></td>
                <td><input type="number" value="${n[2]}" step="0.1" data-row="${i}" data-col="2"></td>
                <td><input type="number" value="${n[7]}" step="1" data-row="${i}" data-col="7"></td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderElemTable() {
        const tbody = document.querySelector('#elem-table tbody');
        if (!tbody || !model) { return; }
        tbody.innerHTML = '';
        model.elem.forEach((e, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td>${e[1]}</td>
                <td>${e[2]}</td>
                <td><input type="number" value="${e[3]}" step="0.01" data-row="${i}" data-col="3"></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ============================================================
    // 단면 SVG → PNG 캡처 (MCP get_section_preview용)
    // ============================================================
    function captureSectionPreview() {
        const svgEl = document.getElementById('section-svg');
        if (!svgEl || !model || !model.node || model.node.length === 0) {
            vscode.postMessage({ command: 'sectionPreviewResult', data: { error: 'No section defined' } });
            return;
        }

        // SVG를 완전한 SVG 문서로 만들기
        const svgClone = /** @type {SVGElement} */ (svgEl.cloneNode(true));
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        // 배경 추가
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('width', '100%');
        bg.setAttribute('height', '100%');
        bg.setAttribute('fill', '#1e1e1e');
        svgClone.insertBefore(bg, svgClone.firstChild);

        const svgData = new XMLSerializer().serializeToString(svgClone);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = 400;
            canvas.height = 400;
            const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
            if (!ctx) { vscode.postMessage({ command: 'sectionPreviewResult', data: { error: 'Canvas ctx null' } }); return; }
            ctx.fillStyle = '#1e1e1e';
            ctx.fillRect(0, 0, 400, 400);
            ctx.drawImage(img, 0, 0, 400, 400);
            URL.revokeObjectURL(url);

            const dataUrl = canvas.toDataURL('image/png');
            vscode.postMessage({
                command: 'sectionPreviewResult',
                data: { png_base64: dataUrl, width: 400, height: 400 }
            });
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            vscode.postMessage({ command: 'sectionPreviewResult', data: { error: 'Image render failed' } });
        };
        img.src = url;
    }

    // ============================================================
    // 단면 SVG 미리보기
    // ============================================================
    function renderSectionSVG() {
        const svg = document.getElementById('section-svg');
        if (!svg || !model || !model.node || model.node.length === 0) { return; }

        // 범위 계산
        let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
        model.node.forEach(n => {
            xMin = Math.min(xMin, n[1]); xMax = Math.max(xMax, n[1]);
            zMin = Math.min(zMin, n[2]); zMax = Math.max(zMax, n[2]);
        });
        const pad = Math.max(xMax - xMin, zMax - zMin) * 0.15 || 1;
        // SVG y축은 아래로 증가, 구조공학 z축은 위로 증가
        // z좌표를 -z로 반전하여 SVG에 표시 (아래에서 -n[2] 사용)
        svg.setAttribute('viewBox',
            `${xMin - pad} ${-(zMax + pad)} ${xMax - xMin + 2 * pad} ${zMax - zMin + 2 * pad}`
        );

        let content = '';

        // 요소 (선분)
        if (model.elem) {
            model.elem.forEach(e => {
                const ni = e[1] - 1; // 1-based → 0-based
                const nj = e[2] - 1;
                if (ni >= 0 && ni < model.node.length && nj >= 0 && nj < model.node.length) {
                    const n1 = model.node[ni];
                    const n2 = model.node[nj];
                    content += `<line x1="${n1[1]}" y1="${-n1[2]}" x2="${n2[1]}" y2="${-n2[2]}"
                        stroke="var(--vscode-charts-blue, #4fc3f7)" stroke-width="0.15"
                        stroke-linecap="round"/>`;
                }
            });
        }

        // 절점 (원) — z좌표 반전 (-z)으로 위쪽이 양수
        model.node.forEach((n, i) => {
            content += `<circle cx="${n[1]}" cy="${-n[2]}" r="0.12"
                fill="var(--vscode-charts-orange, #ff9800)"/>`;
            content += `<text x="${n[1] + 0.2}" y="${-n[2] - 0.2}"
                font-size="0.4" fill="var(--vscode-descriptionForeground)">${i + 1}</text>`;
        });

        svg.innerHTML = content;
    }

    /** Cross Section Preview에 도심 좌표축 + 주축 표시 */
    function renderSectionAxes(props) {
        const svg = document.getElementById('section-svg');
        if (!svg || !props || !model || !model.node || model.node.length === 0) { return; }

        const xcg = props.xcg;
        const zcg = -props.zcg;  // z축 반전 (SVG y=아래 vs 구조 z=위)
        const thetap = -(props.thetap || 0) * Math.PI / 180;  // 각도도 반전

        // 축 길이 = 단면 크기의 40%
        let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
        model.node.forEach(n => {
            xMin = Math.min(xMin, n[1]); xMax = Math.max(xMax, n[1]);
            zMin = Math.min(zMin, n[2]); zMax = Math.max(zMax, n[2]);
        });
        const axLen = Math.max(xMax - xMin, zMax - zMin) * 0.35;
        const arrSz = axLen * 0.08; // 화살표 크기
        const fs = axLen * 0.12; // 폰트 크기

        let axes = '';

        // --- 기하축 (x, z) 점선 ---
        // x축 (가로)
        const x1 = xcg - axLen; const x2 = xcg + axLen;
        axes += '<line x1="' + x1 + '" y1="' + zcg + '" x2="' + x2 + '" y2="' + zcg + '" stroke="#4fc3f7" stroke-width="0.06" stroke-dasharray="0.15,0.1" opacity="0.7"/>';
        // x축 화살표
        axes += '<polygon points="' + x2 + ',' + zcg + ' ' + (x2-arrSz) + ',' + (zcg-arrSz/2) + ' ' + (x2-arrSz) + ',' + (zcg+arrSz/2) + '" fill="#4fc3f7" opacity="0.7"/>';
        axes += '<text x="' + (x2+fs*0.3) + '" y="' + (zcg+fs*0.3) + '" font-size="' + fs + '" fill="#4fc3f7" font-weight="bold">x</text>';
        // z축 (세로, 좌표 반전됨: SVG에서 음수방향 = z+ = 위쪽)
        const z1 = zcg + axLen; const z2 = zcg - axLen;  // z2가 위(SVG 음수)
        axes += '<line x1="' + xcg + '" y1="' + z1 + '" x2="' + xcg + '" y2="' + z2 + '" stroke="#ff9800" stroke-width="0.06" stroke-dasharray="0.15,0.1" opacity="0.7"/>';
        // z축 화살표 (위로 = SVG 음수 방향)
        axes += '<polygon points="' + xcg + ',' + z2 + ' ' + (xcg-arrSz/2) + ',' + (z2+arrSz) + ' ' + (xcg+arrSz/2) + ',' + (z2+arrSz) + '" fill="#ff9800" opacity="0.7"/>';
        axes += '<text x="' + (xcg+fs*0.3) + '" y="' + (z2-fs*0.3) + '" font-size="' + fs + '" fill="#ff9800" font-weight="bold">z</text>';
        // 원점 표시
        axes += '<circle cx="' + xcg + '" cy="' + zcg + '" r="' + (arrSz*0.6) + '" fill="none" stroke="#fff" stroke-width="0.05"/>';
        axes += '<text x="' + (xcg-fs*1.2) + '" y="' + (zcg+fs*0.3) + '" font-size="' + (fs*0.8) + '" fill="#aaa">CG</text>';

        // --- 주축 (1, 2) 실선 ---
        if (Math.abs(thetap) > 0.001) {
            const c = Math.cos(thetap);
            const s = Math.sin(thetap);
            const pLen = axLen * 0.8;
            // 주축 1
            axes += '<line x1="' + (xcg - pLen*c) + '" y1="' + (zcg - pLen*s) + '" x2="' + (xcg + pLen*c) + '" y2="' + (zcg + pLen*s) + '" stroke="#e57373" stroke-width="0.05" opacity="0.6"/>';
            axes += '<text x="' + (xcg + pLen*c + fs*0.3) + '" y="' + (zcg + pLen*s) + '" font-size="' + (fs*0.8) + '" fill="#e57373">1</text>';
            // 주축 2
            axes += '<line x1="' + (xcg + pLen*s) + '" y1="' + (zcg - pLen*c) + '" x2="' + (xcg - pLen*s) + '" y2="' + (zcg + pLen*c) + '" stroke="#e57373" stroke-width="0.05" opacity="0.6"/>';
            axes += '<text x="' + (xcg - pLen*s + fs*0.3) + '" y="' + (zcg + pLen*c) + '" font-size="' + (fs*0.8) + '" fill="#e57373">2</text>';
            // 회전각 표시
            const angDeg = (props.thetap).toFixed(1);
            axes += '<text x="' + (xcg + fs*0.5) + '" y="' + (zcg - fs*0.5) + '" font-size="' + (fs*0.7) + '" fill="#e57373" opacity="0.8">θp=' + angDeg + '°</text>';
        }

        // 기존 SVG에 축 추가
        svg.innerHTML += axes;
    }

    // ============================================================
    // 단면 성질 표시
    // ============================================================
    function renderProperties(props) {
        lastProps = props;
        updatePropertiesTable(props);
        renderSectionAxes(props);
    }

    function updatePropertiesTable(props) {
        const el = document.getElementById('section-props');
        if (!el || !props) { return; }
        // [이름, US값, unitType] — 값은 항상 US 내부값
        const rows = [
            ['A (단면적)',             props.A,      'area'],
            ['Ixx (강축 2차모멘트)',    props.Ixx,    'inertia'],
            ['Izz (약축 2차모멘트)',    props.Izz,    'inertia'],
            ['Ixz (상승적 2차모멘트)',  props.Ixz,    'inertia'],
            ['Sx (강축 단면계수)',      props.Sx,     'modulus'],
            ['Sz (약축 단면계수)',      props.Sz,     'modulus'],
            ['Zx (강축 소성단면계수)',  props.Zx,     'modulus'],
            ['Zz (약축 소성단면계수)',  props.Zz,     'modulus'],
            ['rx (강축 회전반경)',      props.rx,     'length'],
            ['rz (약축 회전반경)',      props.rz,     'length'],
            ['xcg (도심 x)',           props.xcg,    'length'],
            ['zcg (도심 z)',           props.zcg,    'length'],
            ['θp (주축 회전각)',       props.thetap, null],
            ['I11 (제1주축)',          props.I11,    'inertia'],
            ['I22 (제2주축)',          props.I22,    'inertia'],
        ];
        let html = '<table class="props-table"><tbody>';
        rows.forEach(([name, val, ut]) => {
            const disp = ut ? fmtVal(val, ut) : fmt(val);
            const uLbl = ut ? unitLabel(ut) : '\u00B0';
            html += '<tr><td>' + name + '</td><td style="text-align:right;font-family:monospace">' + disp + '</td><td>' + uLbl + '</td></tr>';
        });
        html += '</tbody></table>';
        el.innerHTML = html;
    }

    // ============================================================
    // DSM 설계값 테이블
    // ============================================================
    function renderDsmResults(data) {
        const el = document.getElementById('dsm-table-container');
        if (!el || !data) { return; }

        const dsmP = data.P;   // 축력 기준 DSM
        const dsmM = data.Mxx; // Mxx 휨 기준 DSM
        const fU = unitLabel('force'), mU = unitLabel('moment'), lU = unitLabel('length');

        let html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<tr style="border-bottom:2px solid var(--vscode-panel-border);">';
        html += '<th style="text-align:left; padding:4px 8px;">Property</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Value</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Half-wavelength</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Load Factor</th>';
        html += '</tr>';

        if (dsmP) {
            html += _dsmHeader('Compression (' + fU + ')');
            html += _dsmRow('Py', dsmP.Py, 'force', '', '', '');
            html += _dsmRow('Pcrl (local)', dsmP.Pcrl, 'force', dsmP.Lcrl, 'length', dsmP.LF_local);
            html += _dsmRow('Pcrd (distortional)', dsmP.Pcrd, 'force', dsmP.Lcrd, 'length', dsmP.LF_dist);
            html += _dsmRow('Pcre (global)', dsmP.Pcre, 'force', dsmP.Lcre, 'length', dsmP.LF_global);
        }

        if (dsmM) {
            html += _dsmHeader('Bending (' + mU + ')');
            html += _dsmRow('My', dsmM.My_xx, 'moment', '', '', '');
            html += _dsmRow('Mcrl (local)', dsmM.Mxxcrl, 'moment', dsmM.Lcrl, 'length', dsmM.LF_local);
            html += _dsmRow('Mcrd (distortional)', dsmM.Mxxcrd, 'moment', dsmM.Lcrd, 'length', dsmM.LF_dist);
            html += _dsmRow('Mcre (global)', dsmM.Mxxcre, 'moment', dsmM.Lcre, 'length', dsmM.LF_global);
        }

        html += '</table>';

        // 극소점 정보
        const dsm = dsmP || dsmM;
        if (dsm && dsm.n_minima !== undefined) {
            html += '<div style="margin-top:6px; font-size:11px; color:var(--vscode-descriptionForeground);">';
            html += 'Detected ' + dsm.n_minima + ' minima';
            if (dsm.minima) {
                dsm.minima.forEach((m, i) => {
                    html += ' | Min ' + (i+1) + ': L=' + fmtVal(m.length, 'length') + ' ' + lU + ', LF=' + m.load_factor.toFixed(4);
                });
            }
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function _dsmHeader(title) {
        return '<tr><td colspan="4" style="padding:6px 8px 2px; font-weight:700; border-top:1px solid var(--vscode-panel-border);">' + title + '</td></tr>';
    }

    function _dsmRow(label, value, valUnit, length, lenUnit, lf) {
        const v = typeof value === 'number' ? fmtVal(value, valUnit) : (value || '-');
        const l = typeof length === 'number' ? fmtVal(length, lenUnit) : (length || '');
        const f = typeof lf === 'number' ? lf.toFixed(4) : (lf || '');
        return '<tr>' +
            '<td style="padding:3px 8px;">' + label + '</td>' +
            '<td style="text-align:right; padding:3px 8px; font-weight:600;">' + v + '</td>' +
            '<td style="text-align:right; padding:3px 8px;">' + l + '</td>' +
            '<td style="text-align:right; padding:3px 8px;">' + f + '</td>' +
        '</tr>';
    }

    // ============================================================
    // 트리 네비게이션 — showSection
    // ============================================================
    function handleShowSection(sectionId) {
        // sectionId → 탭 매핑
        const tabMap = {
            'preprocessor': 'preprocessor', 'template': 'preprocessor',
            'material': 'preprocessor', 'node-elem': 'preprocessor',
            'section-preview': 'preprocessor',
            'analysis': 'analysis', 'boundary-condition': 'analysis',
            'lengths': 'analysis', 'cfsm-settings': 'analysis',
            'run-analysis': 'analysis',
            'postprocessor': 'postprocessor', 'buckling-curve': 'postprocessor',
            'mode-shape-2d': 'postprocessor', 'mode-shape-3d': 'postprocessor',
            'classification': 'postprocessor', 'plastic-surface': 'postprocessor',
            'design': 'design', 'report': 'report', 'validation': 'validation',
        };

        // focus-* 시리즈는 설계 탭으로 이동 후 해당 요소에 포커스
        const focusMap = {
            'focus-template': ['preprocessor', 'select-template'],
            'focus-tpl-H': ['preprocessor', 'tpl-H'],
            'focus-design-fy': ['design', 'design-fy'],
            'focus-props': ['preprocessor', null],
            'focus-dsm-P': ['postprocessor', null],
            'focus-dsm-M': ['postprocessor', null],
            'focus-member-type': ['design', 'select-member-type'],
            'focus-span-type': ['design', 'select-span-type'],
            'focus-spacing': ['design', 'config-spacing'],
            'focus-design-Lb': ['design', 'design-Lb'],
            'focus-load-D': ['design', 'load-D-psf'],
            'focus-load-Lr': ['design', 'load-Lr-psf'],
            'focus-load-S': ['design', 'load-S-psf'],
            'focus-load-L': ['design', 'load-L-psf'],
            'focus-load-W': ['design', 'load-Wu-psf'],
            'focus-gravity-combo': ['design', 'load-analysis-result'],
            'focus-max-Mu': ['design', 'design-Mx'],
            'focus-max-Vu': ['design', 'design-V'],
            'focus-deflection': ['design', 'load-analysis-result'],
            'focus-controlling-mode': ['design', 'design-summary'],
            'focus-design-Mn': ['design', 'design-summary'],
            'focus-design-Pn': ['design', 'design-summary'],
            'focus-utilization': ['design', 'design-summary'],
            'focus-validation-fail': ['validation', 'validation-container'],
            'focus-validation-warn': ['validation', 'validation-container'],
            'focus-validation-pass': ['validation', 'validation-container'],
        };

        if (focusMap[sectionId]) {
            const [tab, elId] = focusMap[sectionId];
            switchTab(tab);
            if (elId) {
                setTimeout(() => {
                    const el = document.getElementById(elId);
                    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); }
                }, 100);
            }
            return;
        }

        const tabId = tabMap[sectionId] || 'preprocessor';
        switchTab(tabId);

        // 자동 실행
        if (sectionId === 'run-analysis') {
            const btn = document.getElementById('btn-run-analysis');
            if (btn) { btn.click(); }
        }
        if (sectionId === 'run-validation') {
            const btn = document.getElementById('btn-run-validation');
            if (btn) { btn.click(); }
        }
    }

    /** 트리뷰에 현재 상태 데이터 전송 */
    function sendTreeUpdate() {
        const selT = document.getElementById('select-template');
        const selM = document.getElementById('select-member-type');
        const selS = document.getElementById('select-span-type');
        const selG = document.getElementById('select-steel-grade');
        const dm = document.getElementById('select-design-method');
        const d = _lastDesignResult;
        const la = _lastLoadAnalysis;

        const data = {
            sectionType: selT ? selT.options[selT.selectedIndex]?.text || '' : '',
            H: getNum('tpl-H', 0) ? getNum('tpl-H', 0) + ' ' + _rul('length') : '',
            B: getNum('tpl-B', 0) ? getNum('tpl-B', 0) + ' ' + _rul('length') : '',
            D: getNum('tpl-D', 0) ? getNum('tpl-D', 0) + ' ' + _rul('length') : '',
            t: getNum('tpl-t', 0) ? getNum('tpl-t', 0) + ' ' + _rul('thickness') : '',
            steelGrade: selG ? selG.options[selG.selectedIndex]?.text || '' : '',
            Fy: getNum('design-fy', 0) ? getNum('design-fy', 0) + ' ' + _rul('stress') : '',
            Fu: getNum('design-fu', 0) ? getNum('design-fu', 0) + ' ' + _rul('stress') : '',
            A: lastProps ? _ruv(lastProps.A, 'area') + ' ' + _rul('area') : '',
            Ixx: lastProps ? _ruv(lastProps.Ixx, 'inertia') + ' ' + _rul('inertia') : '',
            Sx: lastProps ? _ruv(lastProps.Sx, 'modulus') : '',
            rx: lastProps ? _ruv(lastProps.rx, 'length') : '',
            rz: lastProps ? _ruv(lastProps.rz, 'length') : '',
            Pcrl: lastDsmResult && lastDsmResult.P ? _ruv(lastDsmResult.P.Pcrl, 'force') : '',
            Pcrd: lastDsmResult && lastDsmResult.P ? _ruv(lastDsmResult.P.Pcrd, 'force') : '',
            Mcrl: lastDsmResult && lastDsmResult.Mxx ? _ruv(lastDsmResult.Mxx.Mxxcrl, 'moment') : '',
            Mcrd: lastDsmResult && lastDsmResult.Mxx ? _ruv(lastDsmResult.Mxx.Mxxcrd, 'moment') : '',
            memberType: selM ? selM.options[selM.selectedIndex]?.text || '' : '',
            spanType: selS ? selS.options[selS.selectedIndex]?.text || '' : '',
            designMethod: dm ? dm.value : 'LRFD',
            spanLength: (() => { const els = document.querySelectorAll('.span-tbl-len'); return els.length > 0 ? parseFloat(els[0].value) + ' ' + _rul('length_ft') : ''; })(),
            spacing: getNum('config-spacing', 0) ? getNum('config-spacing', 0) + ' ' + _rul('length_ft') : '',
            loadD: getNum('load-D-psf', 0) ? getNum('load-D-psf', 0) + ' ' + _rul('pressure') : '',
            loadLr: getNum('load-Lr-psf', 0) ? getNum('load-Lr-psf', 0) + ' ' + _rul('pressure') : '',
            loadS: getNum('load-S-psf', 0) ? getNum('load-S-psf', 0) + ' ' + _rul('pressure') : '',
            loadW: getNum('load-Wu-psf', 0) ? getNum('load-Wu-psf', 0) + ' ' + _rul('pressure') : '',
            loadL: getNum('load-L-psf', 0) ? getNum('load-L-psf', 0) + ' ' + _rul('pressure') : '',
            hasLoadAnalysis: !!la,
            gravityCombo: la && la.gravity ? la.gravity.combo : '',
            maxMu: la && la.gravity && la.gravity.locations ? fmtVal(Math.max(...la.gravity.locations.map(l => Math.abs(l.Mu || 0))), 'moment_ft') + ' ' + _rul('moment_ft') : '',
            maxVu: la && la.gravity && la.gravity.locations ? fmtVal(Math.max(...la.gravity.locations.filter(l => l.Vu != null).map(l => Math.abs(l.Vu))), 'force') + ' ' + _rul('force') : '',
            maxDeflection: la && la.deflection && la.deflection.per_span ? fmtVal(Math.max(...la.deflection.per_span.map(p => p.abs_delta_in)), 'length') + ' ' + _rul('length') : '',
            deflectionRatio: la && la.deflection && la.deflection.per_span ? Math.min(...la.deflection.per_span.map(p => p.L_over_delta)).toFixed(0) : '',
            hasDesignResult: !!(d && !d.error),
            designMn: d && d.Mn ? fmtVal(d.design_strength || d.phi_Mn || d.Mn_omega, 'moment') + ' ' + _rul('moment') : '',
            designPn: d && d.Pn ? fmtVal(d.design_strength || d.phi_Pn || d.Pn_omega, 'force') + ' ' + _rul('force') : '',
            controllingMode: d ? d.controlling_mode || '' : '',
            utilization: d && d.utilization != null ? (d.utilization * 100).toFixed(1) + '%' : '',
            passOrFail: d ? (d.pass ? 'OK' : 'NG') : '',
        };
        vscode.postMessage({ command: 'treeUpdate', data });
    }

    // ============================================================
    // 소성곡면 생성
    // ============================================================
    const btnPlastic = document.getElementById('btn-run-plastic');
    if (btnPlastic) {
        btnPlastic.addEventListener('click', () => {
            if (!model || !model.node || model.node.length === 0) { return; }
            const fy = fromDisplay(getNum('input-fy', 52.94), 'stress');
            vscode.postMessage({
                command: 'runPlastic',
                data: { node: model.node, elem: model.elem, fy }
            });
        });
    }

    function renderPlasticSurface(data) {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('plastic-surface-canvas'));
        if (!canvas || !data || !data.P) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
        const gridColor = style.getPropertyValue('--vscode-panel-border').trim() || '#333';

        const P = data.P, M11 = data.M11, M22 = data.M22;
        if (!M11 || !M22) { return; }

        // --- Convex Hull 추출 (정규화된 좌표) ---
        const pts11 = [], pts22 = [];
        for (let i = 0; i < P.length; i++) {
            pts11.push([M11[i], P[i]]);
            pts22.push([M22[i], P[i]]);
        }
        const hull11 = _convexHull(pts11);
        const hull22 = _convexHull(pts22);

        // --- 두 차트 영역 설정 ---
        const gap = 20;
        const chartW = Math.floor((W - gap) / 2);
        const infoH = 50; // 하단 정보 영역
        const chartH = H - infoH;

        // 왼쪽: P/Py vs M11/M11y
        _drawPMChart(ctx, hull11, 0, 0, chartW, chartH,
            'P/Py vs M\u2081\u2081/M\u2081\u2081y', 'M\u2081\u2081 / M\u2081\u2081y', 'P / Py',
            '#4fc3f7', 'rgba(79,195,247,', fg, gridColor);

        // 오른쪽: P/Py vs M22/M22y
        _drawPMChart(ctx, hull22, chartW + gap, 0, chartW, chartH,
            'P/Py vs M\u2082\u2082/M\u2082\u2082y', 'M\u2082\u2082 / M\u2082\u2082y', 'P / Py',
            '#ff7043', 'rgba(255,112,67,', fg, gridColor);

        // --- 하단 정보 패널 ---
        const fy = data.fy || '?';
        const tp = (data.thetap || 0).toFixed(1);
        const infoY = chartH + 8;

        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        ctx.fillRect(0, chartH, W, infoH);

        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = '#4fc3f7';
        const c1x = 10;
        ctx.fillText('Py = ' + fmtVal(data.Py, 'force') + ' ' + unitLabel('force'), c1x, infoY + 14);
        ctx.fillText('M\u2081\u2081y = ' + fmtVal(data.M11_y, 'moment') + ' ' + unitLabel('moment'), c1x, infoY + 30);

        ctx.fillStyle = '#ff7043';
        const c2x = 185;
        ctx.fillText('M\u2082\u2082y = ' + fmtVal(data.M22_y, 'moment') + ' ' + unitLabel('moment'), c2x, infoY + 14);
        ctx.fillText('\u03B8p = ' + tp + '\u00B0', c2x, infoY + 30);

        ctx.fillStyle = '#aaa';
        const c3x = 370;
        ctx.fillText('fy = ' + fmtVal(fy, 'stress') + ' ' + unitLabel('stress'), c3x, infoY + 14);
        ctx.fillText('Mxxy = ' + fmtVal(data.Mxx_y, 'moment') + '  Mzzy = ' + fmtVal(data.Mzz_y, 'moment'), c3x, infoY + 30);
    }

    /**
     * P-M 상호작용 다이어그램 1개 그리기 (정규화된 좌표)
     * @param {CanvasRenderingContext2D} ctx
     * @param {number[][]} hull - convex hull [[m, p], ...]
     * @param {number} ox - 차트 영역 왼쪽 x
     * @param {number} oy - 차트 영역 위쪽 y
     * @param {number} cw - 차트 영역 너비
     * @param {number} ch - 차트 영역 높이
     * @param {string} title - 차트 제목
     * @param {string} xLabel - x축 라벨
     * @param {string} yLabel - y축 라벨
     * @param {string} color - 곡선/채움 색상
     * @param {string} colorBase - rgba 접두어 (예: 'rgba(79,195,247,')
     * @param {string} fg - 전경색
     * @param {string} gridColor - 그리드색
     */
    function _drawPMChart(ctx, hull, ox, oy, cw, ch,
                          title, xLabel, yLabel, color, colorBase, fg, gridColor) {
        const pad = { top: 28, right: 12, bottom: 38, left: 48 };
        const plotL = ox + pad.left;
        const plotR = ox + cw - pad.right;
        const plotT = oy + pad.top;
        const plotB = oy + ch - pad.bottom;
        const pw = plotR - plotL;
        const ph = plotB - plotT;

        // 데이터 범위 (정규화 → 대략 ±1.x)
        let mMin = 0, mMax = 0, pMin = 0, pMax = 0;
        hull.forEach(pt => {
            if (pt[0] < mMin) { mMin = pt[0]; }
            if (pt[0] > mMax) { mMax = pt[0]; }
            if (pt[1] < pMin) { pMin = pt[1]; }
            if (pt[1] > pMax) { pMax = pt[1]; }
        });
        // 대칭 범위 + 10% 여유
        const mAbs = Math.max(Math.abs(mMin), Math.abs(mMax), 0.1) * 1.15;
        const pAbs = Math.max(Math.abs(pMin), Math.abs(pMax), 0.1) * 1.15;

        const toX = (m) => plotL + (m / mAbs + 1) / 2 * pw;
        const toY = (p) => plotB - (p / pAbs + 1) / 2 * ph;

        // --- 배경 ---
        ctx.save();
        ctx.beginPath();
        ctx.rect(plotL, plotT, pw, ph);
        ctx.clip();

        // --- 그리드 ---
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.4;
        const ticks = [-1.0, -0.5, 0.5, 1.0];
        ticks.forEach(v => {
            // 수직선 (M축)
            if (Math.abs(v) <= mAbs) {
                const x = toX(v);
                ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke();
            }
            // 수평선 (P축)
            if (Math.abs(v) <= pAbs) {
                const y = toY(v);
                ctx.beginPath(); ctx.moveTo(plotL, y); ctx.lineTo(plotR, y); ctx.stroke();
            }
        });

        // 중심축 (진한 점선)
        ctx.strokeStyle = fg;
        ctx.lineWidth = 0.6;
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(toX(0), plotT); ctx.lineTo(toX(0), plotB); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(plotL, toY(0)); ctx.lineTo(plotR, toY(0)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;

        // --- 상호작용 곡면 채움 ---
        if (hull.length > 2) {
            const cx0 = toX(0), cy0 = toY(0);
            const grad = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, pw * 0.55);
            grad.addColorStop(0, colorBase + '0.30)');
            grad.addColorStop(1, colorBase + '0.05)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            hull.forEach((pt, i) => {
                const px = toX(pt[0]), py = toY(pt[1]);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.fill();

            // 외곽선
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            hull.forEach((pt, i) => {
                const px = toX(pt[0]), py = toY(pt[1]);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
        }

        // --- 핵심 마커: ±1 포인트 ---
        const markers = [
            { m: 0, p: 1,  label: '1.0',  dx: 6,  dy: -6 },
            { m: 0, p: -1, label: '-1.0', dx: 6,  dy: 14 },
            { m: 1, p: 0,  label: '1.0',  dx: 4,  dy: -6 },
            { m: -1, p: 0, label: '-1.0', dx: -4, dy: -6 },
        ];
        markers.forEach(mk => {
            if (Math.abs(mk.m) > mAbs || Math.abs(mk.p) > pAbs) { return; }
            const px = toX(mk.m), py = toY(mk.p);
            // 마커 점
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // 라벨
            ctx.font = 'bold 10px sans-serif';
            ctx.fillStyle = color;
            ctx.textAlign = mk.dx < 0 ? 'right' : 'left';
            ctx.fillText(mk.label, px + mk.dx, py + mk.dy);
        });

        ctx.restore(); // clip 해제

        // --- 축 눈금 라벨 ---
        ctx.font = '9px sans-serif';
        ctx.fillStyle = fg;
        ctx.globalAlpha = 0.7;
        // X축 눈금
        ctx.textAlign = 'center';
        [-1.0, -0.5, 0, 0.5, 1.0].forEach(v => {
            if (Math.abs(v) > mAbs) { return; }
            const x = toX(v);
            if (x < plotL + 5 || x > plotR - 5) { return; }
            ctx.fillText(v.toFixed(1), x, plotB + 12);
        });
        // Y축 눈금
        ctx.textAlign = 'right';
        [-1.0, -0.5, 0, 0.5, 1.0].forEach(v => {
            if (Math.abs(v) > pAbs) { return; }
            const y = toY(v);
            if (y < plotT + 5 || y > plotB - 5) { return; }
            ctx.fillText(v.toFixed(1), plotL - 4, y + 3);
        });
        ctx.globalAlpha = 1.0;

        // --- 축 라벨 ---
        ctx.fillStyle = fg;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, (plotL + plotR) / 2, plotB + 28);
        ctx.save();
        ctx.translate(ox + 11, (plotT + plotB) / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();

        // --- 차트 프레임 ---
        ctx.strokeStyle = fg;
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 1;
        ctx.strokeRect(plotL, plotT, pw, ph);
        ctx.globalAlpha = 1.0;

        // --- 제목 ---
        ctx.fillStyle = color;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(title, (plotL + plotR) / 2, oy + 16);
    }

    // 축 눈금 간격 계산 (1, 2, 5, 10, 20, 50, ... 패턴)
    function _niceStep(range, maxTicks) {
        const rough = range / maxTicks;
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        const norm = rough / mag;
        let nice;
        if (norm <= 1.5) { nice = 1; }
        else if (norm <= 3.5) { nice = 2; }
        else if (norm <= 7.5) { nice = 5; }
        else { nice = 10; }
        return nice * mag;
    }

    // Convex Hull (Graham Scan)
    function _convexHull(points) {
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

    // ============================================================
    // 템플릿 생성
    // ============================================================
    // 립 각도 필드 표시/숨김
    const selTemplateEl = document.getElementById('select-template');
    const qlipGroup = document.getElementById('tpl-qlip-group');
    if (selTemplateEl && qlipGroup) {
        selTemplateEl.addEventListener('change', () => {
            const v = /** @type {HTMLSelectElement} */ (selTemplateEl).value;
            qlipGroup.style.display = (v === 'lippedc' || v === 'lippedz' || v === 'lipped_angle') ? 'inline' : 'none';
        });
    }

    const btnGenTemplate = document.getElementById('btn-generate-template');
    if (btnGenTemplate) {
        btnGenTemplate.addEventListener('click', () => {
            const selTemplate = document.getElementById('select-template');
            const sectionType = selTemplate ? selTemplate.value : '';
            if (!sectionType) { return; }

            const params = {
                H: fromDisplay(getNum('tpl-H', 7.874), 'length'),
                B: fromDisplay(getNum('tpl-B', 2.953), 'length'),
                D: fromDisplay(getNum('tpl-D', 0.787), 'length'),
                t: fromDisplay(getNum('tpl-t', 0.0906), 'thickness'),
                r: fromDisplay(getNum('tpl-r', 0.157), 'radius'),
            };

            // 립 각도 (Lipped C/Z/Angle)
            if (sectionType === 'lippedc' || sectionType === 'lippedz' || sectionType === 'lipped_angle') {
                params.qlip = getNum('tpl-qlip', 90);
            }

            // CHS는 D만 사용
            if (sectionType === 'chs') {
                params.D = params.H; // 직경으로 사용
            }

            vscode.postMessage({
                command: 'generateTemplate',
                data: { section_type: sectionType, params }
            });
        });
    }

    // ============================================================
    // 해석 실행
    // ============================================================
    // Load Case 선택 시 custom 입력 표시/숨김
    // ── 응력 분포 프리뷰 SVG ──
    function renderStressPreview() {
        const svgEl = document.getElementById('stress-preview-svg');
        if (!svgEl || !model || !model.node || model.node.length < 2) {
            if (svgEl) svgEl.innerHTML = '<text x="95" y="110" text-anchor="middle" fill="#999" font-size="11">단면을 먼저 생성하세요</text>';
            return;
        }

        const loadCase = document.getElementById('select-load-case')?.value || 'compression';
        const fy = fromDisplay(getNum('input-fy-load', 52.94), 'stress');
        const nodes = model.node;

        // 선택된 Load Case에 따른 응력 계산 (해석 전 프리뷰용 간이 계산)
        const stresses = [];
        let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
        for (const n of nodes) {
            xMin = Math.min(xMin, n[1]); xMax = Math.max(xMax, n[1]);
            zMin = Math.min(zMin, n[2]); zMax = Math.max(zMax, n[2]);
        }
        const zMid = (zMin + zMax) / 2;
        const xMid = (xMin + xMax) / 2;
        const zRange = (zMax - zMin) || 1;
        const xRange = (xMax - xMin) || 1;

        for (const n of nodes) {
            let s = 0;
            if (loadCase === 'compression') {
                s = fy; // 균일 압축 (양수 = 압축)
            } else if (loadCase === 'bending_xx_pos') {
                // +Mxx: z+ 압축, z- 인장 → 선형 분포
                s = fy * (n[2] - zMid) / (zRange / 2);
            } else if (loadCase === 'bending_xx_neg') {
                s = -fy * (n[2] - zMid) / (zRange / 2);
            } else if (loadCase === 'bending_zz_pos') {
                s = fy * (n[1] - xMid) / (xRange / 2);
            } else if (loadCase === 'bending_zz_neg') {
                s = -fy * (n[1] - xMid) / (xRange / 2);
            } else if (loadCase === 'custom') {
                const P = getNum('input-load-P', 0);
                const Mxx = getNum('input-load-Mxx', 0);
                const Mzz = getNum('input-load-Mzz', 0);
                const pStress = (P !== 0) ? fy : 0;
                const mxxStress = (Mxx !== 0) ? fy * (n[2] - zMid) / (zRange / 2) * Math.sign(Mxx) : 0;
                const mzzStress = (Mzz !== 0) ? fy * (n[1] - xMid) / (xRange / 2) * Math.sign(Mzz) : 0;
                s = pStress + mxxStress + mzzStress;
            }
            stresses.push(s);
        }

        const maxAbsS = Math.max(...stresses.map(s => Math.abs(s)), 0.001);

        // SVG 그리기
        const W = 190, H = 220;
        const PAD = 20;
        const secW = W - PAD * 2;
        const secH = H - PAD * 2 - 30; // 하단 범례 여유
        const scaleX = xRange > 0 ? secW / xRange : 1;
        const scaleZ = zRange > 0 ? secH / zRange : 1;
        const scale = Math.min(scaleX, scaleZ) * 0.7;
        const offX = W / 2;
        const offZ = (H - 30) / 2;

        function toSvg(x, z) {
            return [offX + (x - (xMin + xMax) / 2) * scale, offZ - (z - (zMin + zMax) / 2) * scale];
        }

        let svg = '';

        // 단면 요소 (회색 선)
        if (model.elem) {
            for (const e of model.elem) {
                const ni = e[1] - 1, nj = e[2] - 1;
                if (ni >= 0 && ni < nodes.length && nj >= 0 && nj < nodes.length) {
                    const [x1, y1] = toSvg(nodes[ni][1], nodes[ni][2]);
                    const [x2, y2] = toSvg(nodes[nj][1], nodes[nj][2]);
                    svg += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="#666" stroke-width="2" stroke-linecap="round"/>';
                }
            }
        }

        // 응력 화살표 (각 절점에서 법선 방향)
        const arrowLen = 25; // 최대 화살표 길이 (px)
        for (let i = 0; i < nodes.length; i++) {
            const [cx, cy] = toSvg(nodes[i][1], nodes[i][2]);
            const s = stresses[i];
            const ratio = s / maxAbsS;
            const len = Math.abs(ratio) * arrowLen;
            if (len < 1) continue;

            // 색상: 압축(+) = 빨강, 인장(-) = 파랑
            const color = s >= 0 ? '#ef5350' : '#42a5f5';

            // 법선 방향 결정 (인접 요소의 평균 법선)
            let nx = 0, nz = 0;
            if (model.elem) {
                for (const e of model.elem) {
                    const ni = e[1] - 1, nj = e[2] - 1;
                    if (ni === i || nj === i) {
                        const dx = nodes[nj][1] - nodes[ni][1];
                        const dz = nodes[nj][2] - nodes[ni][2];
                        const mag = Math.sqrt(dx * dx + dz * dz) || 1;
                        nx += -dz / mag;
                        nz += dx / mag;
                    }
                }
            }
            const nmag = Math.sqrt(nx * nx + nz * nz) || 1;
            nx /= nmag; nz /= nmag;

            // SVG 좌표에서의 법선 방향 (z 반전)
            const dx = nx * len * scale / Math.max(scaleX, scaleZ);
            const dy = -nz * len * scale / Math.max(scaleX, scaleZ);
            // 방향: 압축은 단면 안쪽, 인장은 바깥쪽
            const dir = s >= 0 ? -1 : 1;
            const ex = cx + dx * dir;
            const ey = cy + dy * dir;

            svg += '<line x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '" stroke="' + color + '" stroke-width="1.5" stroke-opacity="0.8"/>';
            // 화살표 머리
            const alen = 3;
            const adx = ex - cx, ady = ey - cy;
            const amag = Math.sqrt(adx * adx + ady * ady) || 1;
            const ux = adx / amag, uy = ady / amag;
            svg += '<polygon points="' +
                ex.toFixed(1) + ',' + ey.toFixed(1) + ' ' +
                (ex - alen * ux + alen * uy * 0.5).toFixed(1) + ',' + (ey - alen * uy - alen * ux * 0.5).toFixed(1) + ' ' +
                (ex - alen * ux - alen * uy * 0.5).toFixed(1) + ',' + (ey - alen * uy + alen * ux * 0.5).toFixed(1) +
                '" fill="' + color + '" fill-opacity="0.8"/>';
        }

        // 절점 점 (응력 색상)
        for (let i = 0; i < nodes.length; i++) {
            const [cx, cy] = toSvg(nodes[i][1], nodes[i][2]);
            const s = stresses[i];
            const ratio = s / maxAbsS;
            // 빨강(압축) ~ 흰색(0) ~ 파랑(인장) 그라데이션
            const r = s >= 0 ? 239 : Math.round(239 + (66 - 239) * Math.abs(ratio));
            const g = s >= 0 ? Math.round(83 + (165 - 83) * (1 - Math.abs(ratio))) : Math.round(83 + (165 - 83) * (1 - Math.abs(ratio)));
            const b = s >= 0 ? Math.round(80 + (245 - 80) * (1 - Math.abs(ratio))) : 245;
            svg += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="3" fill="rgb(' + r + ',' + g + ',' + b + ')" stroke="#fff" stroke-width="0.5"/>';
        }

        // Load Case 라벨
        const caseLabels = {
            compression: '균일 압축',
            bending_xx_pos: '+Mxx 강축 휨',
            bending_xx_neg: '-Mxx 강축 휨',
            bending_zz_pos: '+Mzz 약축 휨',
            bending_zz_neg: '-Mzz 약축 휨',
            custom: '조합 하중',
        };
        svg += '<text x="95" y="' + (H - 8) + '" text-anchor="middle" fill="var(--vscode-foreground)" font-size="10" font-weight="600">' + (caseLabels[loadCase] || loadCase) + '</text>';
        svg += '<text x="95" y="' + (H - 0) + '" text-anchor="middle" fill="var(--vscode-descriptionForeground)" font-size="8">Fy=' + toDisplay(fy, 'stress').toFixed(unitDec('stress')) + ' ' + unitLabel('stress') + '</text>';

        svgEl.innerHTML = svg;
    }

    const selLoadCase = document.getElementById('select-load-case');
    if (selLoadCase) {
        selLoadCase.addEventListener('change', () => {
            const customDiv = document.getElementById('custom-load-inputs');
            if (customDiv) {
                customDiv.style.display = selLoadCase.value === 'custom' ? 'flex' : 'none';
            }
            renderStressPreview();
        });
        // Fy 변경 시에도 프리뷰 갱신
        const fyInput = document.getElementById('input-fy-load');
        if (fyInput) fyInput.addEventListener('input', renderStressPreview);
        // custom 하중 변경 시
        ['input-load-P', 'input-load-Mxx', 'input-load-Mzz'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', renderStressPreview);
        });
    }

    // 초기 프리뷰 (모델 로드 후)
    setTimeout(renderStressPreview, 500);

    const btnRun = document.getElementById('btn-run-analysis');
    if (btnRun) {
        btnRun.addEventListener('click', () => {
            if (!model) { return; }

            const lenMin = fromDisplay(getNum('input-len-min', 0.394), 'length');
            const lenMax = fromDisplay(getNum('input-len-max', 393.7), 'length');
            const lenN = getNum('input-len-n', 60);
            const neigs = getNum('input-neigs', 20);
            const BC = /** @type {HTMLSelectElement} */ (document.getElementById('select-bc'))?.value || 'S-S';

            // logspace 생성
            const lengths = logspace(Math.log10(lenMin), Math.log10(lenMax), lenN);
            const m_all = lengths.map(() => [1]);

            const E = fromDisplay(getNum('input-E', 29435), 'stress');
            const v = getNum('input-v', 0.3);
            const G = fromDisplay(getNum('input-G', 11326), 'stress');

            // 모델 업데이트
            model.prop = [[100, E, E, v, v, G]];
            model.lengths = lengths;
            model.m_all = m_all;
            model.BC = BC;
            model.neigs = neigs;

            // Load Case에 따라 stress 자동 설정
            const loadCase = /** @type {HTMLSelectElement} */ (document.getElementById('select-load-case'))?.value || 'compression';
            const fyLoad = fromDisplay(getNum('input-fy-load', 52.94), 'stress');

            if (loadCase === 'compression') {
                vscode.postMessage({
                    command: 'setStress',
                    data: { type: 'uniform_compression', fy: fyLoad }
                });
            } else if (loadCase === 'bending_xx_pos') {
                vscode.postMessage({
                    command: 'setStress',
                    data: { type: 'pure_bending', fy: fyLoad }
                });
            } else if (loadCase === 'bending_xx_neg') {
                vscode.postMessage({
                    command: 'setStress',
                    data: { type: 'custom', P: 0, Mxx: -1, Mzz: 0, fy: fyLoad }
                });
            } else if (loadCase === 'bending_zz_pos') {
                vscode.postMessage({
                    command: 'setStress',
                    data: { type: 'custom', P: 0, Mxx: 0, Mzz: 1, fy: fyLoad }
                });
            } else if (loadCase === 'bending_zz_neg') {
                vscode.postMessage({
                    command: 'setStress',
                    data: { type: 'custom', P: 0, Mxx: 0, Mzz: -1, fy: fyLoad }
                });
            } else if (loadCase === 'custom') {
                vscode.postMessage({
                    command: 'setStress',
                    data: {
                        type: 'custom',
                        P: getNum('input-load-P', 0),
                        Mxx: getNum('input-load-Mxx', 0),
                        Mzz: getNum('input-load-Mzz', 0),
                    }
                });
            }

            // stress 설정 후 해석 실행 (약간의 지연으로 stress 반영 보장)
            setTimeout(() => {
                vscode.postMessage({ command: 'runAnalysis', data: model });
            }, 200);
        });
    }

    // ============================================================
    // 좌굴 곡선 (Canvas)
    // ============================================================
    function renderBucklingCurve() {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('buckling-curve-canvas'));
        if (!canvas || !analysisResult || !analysisResult.curve) { return; }

        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const w = canvas.width;
        const h = canvas.height;
        const pad = { top: 30, right: 30, bottom: 50, left: 70 };

        // 데이터 추출: [length, lf1]
        const points = [];
        analysisResult.curve.forEach(row => {
            if (row && row.length >= 2 && row[1] > 0) {
                points.push([row[0], row[1]]);
            }
        });
        if (points.length === 0) { return; }

        const xMin = Math.log10(Math.min(...points.map(p => p[0])));
        const xMax = Math.log10(Math.max(...points.map(p => p[0])));
        const yMax = Math.max(...points.map(p => p[1])) * 1.15;
        const yMin = 0;

        const plotLeft = pad.left;
        const plotRight = w - pad.right;
        const plotTop = pad.top;
        const plotBottom = h - pad.bottom;

        const toX = (val) => plotLeft + (Math.log10(val) - xMin) / (xMax - xMin) * (plotRight - plotLeft);
        const toY = (val) => plotBottom - ((val - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
        const fromX = (px) => Math.pow(10, xMin + (px - plotLeft) / (plotRight - plotLeft) * (xMax - xMin));
        const fromY = (py) => yMin + (plotBottom - py) / (plotBottom - plotTop) * (yMax - yMin);

        function drawChart(mouseX, mouseY) {
            ctx.clearRect(0, 0, w, h);

            const style = getComputedStyle(document.body);
            const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
            const gridColor = style.getPropertyValue('--vscode-panel-border').trim() || '#333';

            // 그리드
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 0.5;
            for (let exp = Math.ceil(xMin); exp <= Math.floor(xMax); exp++) {
                const x = toX(Math.pow(10, exp));
                ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBottom); ctx.stroke();
            }
            // Y 그리드
            const yStep = Math.pow(10, Math.floor(Math.log10(yMax / 4)));
            for (let yv = yStep; yv < yMax; yv += yStep) {
                const y = toY(yv);
                ctx.beginPath(); ctx.moveTo(plotLeft, y); ctx.lineTo(plotRight, y); ctx.stroke();
            }

            // 다중 모드 곡선
            const modeColors = ['#4fc3f7', '#81c784', '#ffb74d', '#e57373', '#ba68c8'];
            const maxModes = Math.min(analysisResult.curve[0] ? analysisResult.curve[0].length - 1 : 1, 5);

            for (let modeIdx = maxModes - 1; modeIdx >= 0; modeIdx--) {
                const modePoints = [];
                analysisResult.curve.forEach(row => {
                    if (row && row.length > modeIdx + 1 && row[modeIdx + 1] > 0) {
                        modePoints.push([row[0], row[modeIdx + 1]]);
                    }
                });
                if (modePoints.length < 2) { continue; }

                ctx.beginPath();
                ctx.strokeStyle = modeColors[modeIdx % modeColors.length];
                ctx.lineWidth = modeIdx === 0 ? 2.5 : 1;
                ctx.globalAlpha = modeIdx === 0 ? 1.0 : 0.35;
                modePoints.forEach((pt, i) => {
                    const px = toX(pt[0]);
                    const py = toY(pt[1]);
                    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
                });
                ctx.stroke();
            }
            ctx.globalAlpha = 1.0;

            // === 모드 범례 (좌상단) ===
            const legendX = plotLeft + 8;
            const legendY = plotTop + 6;
            const legendLabels = ['Mode 1 (설계값)', 'Mode 2', 'Mode 3', 'Mode 4', 'Mode 5'];
            const visibleModes = Math.min(maxModes, 5);
            ctx.font = '10px sans-serif';
            const legendH = visibleModes * 14 + 6;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(legendX, legendY, 110, legendH);
            ctx.strokeStyle = gridColor;
            ctx.lineWidth = 0.5;
            ctx.strokeRect(legendX, legendY, 110, legendH);
            for (let mi = 0; mi < visibleModes; mi++) {
                const ly = legendY + 12 + mi * 14;
                // 색상 선
                ctx.strokeStyle = modeColors[mi % modeColors.length];
                ctx.lineWidth = mi === 0 ? 2.5 : 1;
                ctx.globalAlpha = mi === 0 ? 1.0 : 0.5;
                ctx.beginPath(); ctx.moveTo(legendX + 4, ly - 3); ctx.lineTo(legendX + 22, ly - 3); ctx.stroke();
                // 텍스트
                ctx.globalAlpha = 1.0;
                ctx.fillStyle = fg;
                ctx.textAlign = 'left';
                ctx.fillText(legendLabels[mi] || `Mode ${mi+1}`, legendX + 26, ly);
            }

            // === DSM 극점 마커 (Mcrl, Mcrd 라벨) ===
            const dsm = lastDsmResult;
            const markerColors = { local: '#ff5722', dist: '#ffab00', global: '#7c4dff' };

            // 극점 데이터 수집
            const extrema = [];
            if (dsm) {
                const d = dsm.Mxx || dsm.P;
                if (d) {
                    if (d.LF_local > 0 && d.Lcrl > 0) {
                        extrema.push({ L: d.Lcrl, LF: d.LF_local, label: d.Mxxcrl !== undefined ? 'Mcrl' : 'Pcrl', color: markerColors.local });
                    }
                    if (d.LF_dist > 0 && d.Lcrd > 0) {
                        extrema.push({ L: d.Lcrd, LF: d.LF_dist, label: d.Mxxcrd !== undefined ? 'Mcrd' : 'Pcrd', color: markerColors.dist });
                    }
                }
            }

            // 극점이 DSM에서 없으면 곡선에서 최소값 찾기
            if (extrema.length === 0) {
                let minPt = points[0];
                points.forEach(p => { if (p[1] < minPt[1]) { minPt = p; } });
                extrema.push({ L: minPt[0], LF: minPt[1], label: 'min', color: markerColors.local });
            }

            // 극점 마커 + 라벨 그리기
            extrema.forEach(ext => {
                const px = toX(ext.L);
                const py = toY(ext.LF);
                // 원형 마커
                ctx.beginPath();
                ctx.arc(px, py, 6, 0, 2 * Math.PI);
                ctx.fillStyle = ext.color;
                ctx.fill();
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // 라벨 배경
                const labelText = ext.label + ' = ' + ext.LF.toFixed(3) + ' @ L=' + fmtVal(ext.L, 'length') + ' ' + unitLabel('length');
                ctx.font = 'bold 11px sans-serif';
                const tw = ctx.measureText(labelText).width;
                const lx = Math.min(px + 12, plotRight - tw - 8);
                const ly = Math.max(py - 12, plotTop + 14);
                ctx.fillStyle = 'rgba(30,30,30,0.85)';
                ctx.fillRect(lx - 4, ly - 12, tw + 8, 16);
                ctx.fillStyle = ext.color;
                ctx.textAlign = 'left';
                ctx.fillText(labelText, lx, ly);
            });

            // 축 라벨
            ctx.fillStyle = fg;
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Half-wavelength (' + unitLabel('length') + ')', w / 2, h - 8);
            ctx.save();
            ctx.translate(14, h / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('Load Factor', 0, 0);
            ctx.restore();

            // X축 눈금
            ctx.fillStyle = fg;
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            for (let exp = Math.ceil(xMin); exp <= Math.floor(xMax); exp++) {
                const tickUS = Math.pow(10, exp);
                ctx.fillText(toDisplay(tickUS, 'length').toFixed(0), toX(tickUS), plotBottom + 16);
            }

            // Y축 눈금
            ctx.textAlign = 'right';
            for (let yv = yStep; yv < yMax; yv += yStep) {
                ctx.fillText(yv.toFixed(2), plotLeft - 6, toY(yv) + 4);
            }

            // === 십자 커서 → 곡선점 스냅 + 좌표 표시 ===
            if (mouseX !== null && mouseY !== null &&
                mouseX >= plotLeft && mouseX <= plotRight &&
                mouseY >= plotTop && mouseY <= plotBottom) {

                // 마우스 x에 가장 가까운 곡선 점 찾기
                let snapPt = null;
                let minDist = Infinity;
                for (const pt of points) {
                    const px = toX(pt[0]);
                    const dist = Math.abs(px - mouseX);
                    if (dist < minDist) {
                        minDist = dist;
                        snapPt = pt;
                    }
                }

                const snapX = snapPt ? toX(snapPt[0]) : mouseX;
                const snapY = snapPt ? toY(snapPt[1]) : mouseY;

                // 십자선 — 곡선점 기준, 플롯 전체 영역
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 1;
                ctx.setLineDash([]);
                ctx.beginPath(); ctx.moveTo(snapX, plotTop); ctx.lineTo(snapX, plotBottom); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(plotLeft, snapY); ctx.lineTo(plotRight, snapY); ctx.stroke();

                // 곡선점 마커
                if (snapPt) {
                    ctx.beginPath();
                    ctx.arc(snapX, snapY, 4, 0, 2 * Math.PI);
                    ctx.fillStyle = '#fff';
                    ctx.fill();
                    ctx.strokeStyle = '#333';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                // 곡선점 좌표 (우상단)
                const dispL = snapPt ? snapPt[0] : fromX(mouseX);
                const dispLF = snapPt ? snapPt[1] : fromY(mouseY);
                const coordText = 'L = ' + fmtVal(dispL, 'length') + ' ' + unitLabel('length') + ',  LF = ' + dispLF.toFixed(4);
                ctx.font = '11px monospace';
                const ctw = ctx.measureText(coordText).width;
                ctx.fillStyle = 'rgba(30,30,30,0.85)';
                ctx.fillRect(plotRight - ctw - 14, plotTop + 2, ctw + 10, 18);
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'right';
                ctx.fillText(coordText, plotRight - 8, plotTop + 15);
            }
        }

        // 초기 그리기 (커서 없이)
        drawChart(null, null);

        // 마우스 이벤트 — 커서 추적
        canvas.onmousemove = function(e) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const mx = (e.clientX - rect.left) * scaleX;
            const my = (e.clientY - rect.top) * scaleY;
            drawChart(mx, my);
        };
        canvas.onmouseleave = function() {
            drawChart(null, null);
        };
    }

    // ============================================================
    // 2D 모드형상 (Canvas)
    // ============================================================
    function renderModeShape2D() {
        const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('mode-shape-canvas'));
        if (!canvas || !analysisResult || !analysisResult.shapes || !model) { return; }

        const selLen = document.getElementById('select-length');
        const selMode = document.getElementById('select-mode');
        if (!selLen || !selMode) { return; }

        const lengthIdx = parseInt(selLen.value) || 0;
        const modeIdx = parseInt(selMode.value) || 0;
        const shapes = analysisResult.shapes;

        if (!shapes[lengthIdx]) { return; }
        const shapeMatrix = shapes[lengthIdx];
        const nnodes = model.node.length;

        // 모드형상 벡터 추출 — DOF: [u1,v1,...un,vn, w1,θ1,...wn,θn]
        const skip = 2 * nnodes;
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const w = canvas.width;
        const h = canvas.height;
        const pad = 40;

        // 원래 절점 좌표
        const xs = model.node.map(n => n[1]);
        const zs = model.node.map(n => n[2]);
        let xMin = Math.min(...xs), xMax = Math.max(...xs);
        let zMin = Math.min(...zs), zMax = Math.max(...zs);
        const range = Math.max(xMax - xMin, zMax - zMin) || 1;
        const scale = (Math.min(w, h) - 2 * pad) / range;

        const toX = (v) => pad + (v - xMin) * scale;
        const toY = (v) => h - pad - (v - zMin) * scale;

        ctx.clearRect(0, 0, w, h);
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';

        // 미변형 단면 (회색)
        ctx.strokeStyle = fg;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3;
        if (model.elem) {
            model.elem.forEach(e => {
                const ni = e[1] - 1, nj = e[2] - 1;
                if (ni >= 0 && ni < nnodes && nj >= 0 && nj < nnodes) {
                    ctx.beginPath();
                    ctx.moveTo(toX(xs[ni]), toY(zs[ni]));
                    ctx.lineTo(toX(xs[nj]), toY(zs[nj]));
                    ctx.stroke();
                }
            });
        }
        ctx.globalAlpha = 1.0;

        // 변형 단면 (파란색)
        // shapeMatrix가 1D 배열이면 modeIdx 번째 모드를 추출
        let modeVec;
        if (Array.isArray(shapeMatrix[0])) {
            // 2D: [ndof][nmodes]
            modeVec = shapeMatrix.map(row => row[modeIdx] || 0);
        } else {
            modeVec = shapeMatrix;
        }

        if (!modeVec || modeVec.length < 4 * nnodes) {
            ctx.fillStyle = fg;
            ctx.font = '12px sans-serif';
            ctx.fillText('No mode shape data available', 20, 30);
            return;
        }

        // 변위 추출: w(면외) 방향을 단면 법선 방향으로 표시
        // DOF 배치: [u1,v1,...un,vn | w1,θ1,...wn,θn]
        const dispScale = range * 0.15; // 변형 스케일

        const dxs = [];
        const dzs = [];
        for (let n = 0; n < nnodes; n++) {
            // 멤브레인: u(면내 축방향) — 작으므로 무시 가능
            // 휨: w(면외) — 단면 변형의 주요 성분
            const w_disp = modeVec[skip + 2 * n] || 0;  // w
            // 면외 변위를 표시하려면 요소 법선 방향 필요
            // 간단히: x방향=u 변위, z방향=w 변위로 근사
            const u_disp = modeVec[2 * n] || 0;
            dxs.push(u_disp * dispScale);
            dzs.push(w_disp * dispScale);
        }

        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        if (model.elem) {
            model.elem.forEach(e => {
                const ni = e[1] - 1, nj = e[2] - 1;
                if (ni >= 0 && ni < nnodes && nj >= 0 && nj < nnodes) {
                    ctx.beginPath();
                    ctx.moveTo(toX(xs[ni] + dxs[ni]), toY(zs[ni] + dzs[ni]));
                    ctx.lineTo(toX(xs[nj] + dxs[nj]), toY(zs[nj] + dzs[nj]));
                    ctx.stroke();
                }
            });
        }

        // 변형 절점
        ctx.fillStyle = '#ff9800';
        for (let n = 0; n < nnodes; n++) {
            ctx.beginPath();
            ctx.arc(toX(xs[n] + dxs[n]), toY(zs[n] + dzs[n]), 3, 0, 2 * Math.PI);
            ctx.fill();
        }

        // 제목
        ctx.fillStyle = fg;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        const curveRow = analysisResult.curve[lengthIdx];
        const lf = curveRow ? (curveRow[modeIdx + 1] || 0).toFixed(4) : '?';
        ctx.fillText(`Mode ${modeIdx + 1}  |  LF = ${lf}`, 10, 16);
    }

    /** 후처리 탭의 길이/모드 셀렉트 갱신 */
    function populatePostSelects() {
        if (!analysisResult || !analysisResult.curve) { return; }
        const selLen = document.getElementById('select-length');
        const selMode = document.getElementById('select-mode');
        if (!selLen || !selMode) { return; }

        selLen.innerHTML = '';
        analysisResult.curve.forEach((row, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = row ? fmtVal(row[0], 'length') : i;
            selLen.appendChild(opt);
        });

        // 첫 번째 길이의 모드 수
        const firstRow = analysisResult.curve[0];
        const nModes = firstRow ? firstRow.length - 1 : 1;
        selMode.innerHTML = '';
        for (let m = 0; m < Math.min(nModes, 10); m++) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = `Mode ${m + 1}`;
            selMode.appendChild(opt);
        }

        selLen.addEventListener('change', () => { renderModeShape2D(); renderModeShape3DWrapper(); });
        selMode.addEventListener('change', () => { renderModeShape2D(); renderModeShape3DWrapper(); });
    }

    // ============================================================
    // 모드 분류 곡선 (G/D/L/O stackplot)
    // ============================================================
    function renderClassifyCurve(clasData) {
        const canvas = document.getElementById('classify-curve-canvas');
        if (!canvas || !clasData || !analysisResult) { return; }

        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const w = canvas.width;
        const h = canvas.height;
        const pad = { top: 20, right: 30, bottom: 40, left: 70 };

        // clasData: [ [%G,%D,%L,%O], ... ] — 각 길이의 1st 모드
        const points = [];
        for (let i = 0; i < clasData.length; i++) {
            const row = clasData[i];
            if (!row || row.length === 0) { continue; }
            const gdlo = Array.isArray(row[0]) ? row[0] : row; // 1st 모드
            const curveRow = analysisResult.curve[i];
            const length = curveRow ? curveRow[0] : i + 1;
            points.push({ length, G: gdlo[0] || 0, D: gdlo[1] || 0, L: gdlo[2] || 0, O: gdlo[3] || 0 });
        }
        if (points.length < 2) { return; }

        const xMin = Math.log10(Math.min(...points.map(p => p.length)));
        const xMax = Math.log10(Math.max(...points.map(p => p.length)));
        const toX = (val) => pad.left + (Math.log10(val) - xMin) / (xMax - xMin) * (w - pad.left - pad.right);

        const plotH = h - pad.top - pad.bottom;
        const toY = (pct, base) => pad.top + plotH - (base + pct) / 100 * plotH;

        ctx.clearRect(0, 0, w, h);

        const colors = { G: '#e57373', D: '#ffb74d', L: '#4fc3f7', O: '#b0bec5' };
        const labels = ['G', 'D', 'L', 'O'];
        const keys = ['G', 'D', 'L', 'O'];

        // 누적 영역 (아래에서 위로)
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            ctx.fillStyle = colors[key];
            ctx.globalAlpha = 0.7;
            ctx.beginPath();

            // 아래 경계
            for (let i = 0; i < points.length; i++) {
                let base = 0;
                for (let j = 0; j < k; j++) { base += points[i][keys[j]]; }
                const x = toX(points[i].length);
                const y = toY(0, base);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            // 위 경계 (역순)
            for (let i = points.length - 1; i >= 0; i--) {
                let base = 0;
                for (let j = 0; j <= k; j++) { base += points[i][keys[j]]; }
                ctx.lineTo(toX(points[i].length), toY(0, base));
            }
            ctx.closePath();
            ctx.fill();
        }
        ctx.globalAlpha = 1.0;

        // 범례
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
        ctx.font = '11px sans-serif';
        let lx = pad.left + 5;
        for (let k = 0; k < keys.length; k++) {
            ctx.fillStyle = colors[keys[k]];
            ctx.fillRect(lx, 4, 12, 12);
            ctx.fillStyle = fg;
            ctx.fillText(labels[k], lx + 15, 14);
            lx += 50;
        }

        // X축
        ctx.fillStyle = fg;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        for (let exp = Math.ceil(xMin); exp <= Math.floor(xMax); exp++) {
            ctx.fillText(Math.pow(10, exp).toString(), toX(Math.pow(10, exp)), h - pad.bottom + 16);
        }

        // Y축 라벨
        ctx.textAlign = 'right';
        ctx.fillText('0%', pad.left - 5, h - pad.bottom);
        ctx.fillText('100%', pad.left - 5, pad.top + 10);
    }

    // ============================================================
    // 3D 모드형상 래퍼
    // ============================================================
    function renderModeShape3DWrapper() {
        if (!analysisResult || !analysisResult.shapes || !model) { return; }

        const selLen = document.getElementById('select-length');
        const selMode = document.getElementById('select-mode');
        if (!selLen || !selMode) { return; }

        const lengthIdx = parseInt(selLen.value) || 0;
        const modeIdx = parseInt(selMode.value) || 0;
        const shapes = analysisResult.shapes;
        if (!shapes[lengthIdx]) { return; }

        const shapeMatrix = shapes[lengthIdx];
        let modeVec;
        if (Array.isArray(shapeMatrix[0])) {
            modeVec = shapeMatrix.map(row => row[modeIdx] || 0);
        } else {
            modeVec = shapeMatrix;
        }

        const curveRow = analysisResult.curve[lengthIdx];
        const length = curveRow ? curveRow[0] : 100;

        // Babylon.js 3D 렌더러 우선 시도
        if (window.CufsmViewer3D) {
            try {
                window.CufsmViewer3D.render({
                    nodes: model.node,
                    elems: model.elem,
                    modeVec: modeVec,
                    length: length,
                    BC: model.BC || 'S-S',
                    scale: 0.3,
                });
                return;
            } catch (e) {
                console.warn('Babylon.js 3D failed, falling back to Canvas:', e);
            }
        }

        // Canvas 2D 등각투영 폴백
        const canvas = document.getElementById('mode-shape-3d-canvas');
        if (canvas && typeof window.renderModeShape3D === 'function') {
            window.renderModeShape3D(canvas, model.node, model.elem, modeVec, length, model.BC || 'S-S');
        }
    }

    // ============================================================
    // 유틸리티
    // ============================================================
    function setStatus(text, cls) {
        const el = document.getElementById('analysis-status');
        if (el) {
            el.textContent = text;
            el.className = 'status-bar ' + (cls || '');
        }
    }

    function setValue(id, val) {
        const el = document.getElementById(id);
        if (el) { el.value = val; }
    }

    function getNum(id, fallback) {
        const el = document.getElementById(id);
        const v = el ? parseFloat(el.value) : NaN;
        return isNaN(v) ? fallback : v;
    }

    function fmt(v) {
        if (typeof v !== 'number') { return '-'; }
        return Math.abs(v) < 0.01 ? v.toExponential(3) : v.toFixed(4);
    }

    function logspace(a, b, n) {
        const arr = [];
        for (let i = 0; i < n; i++) {
            arr.push(Math.pow(10, a + (b - a) * i / (n - 1)));
        }
        return arr;
    }

    // ============================================================
    // Design 탭 — AISI S100-16 설계
    // ============================================================

    // --- Collapsible section toggle ---
    document.querySelectorAll('#tab-design .collapsible').forEach(h3 => {
        h3.addEventListener('click', () => {
            const body = h3.nextElementSibling;
            if (!body) return;
            const expanded = h3.dataset.expanded === 'true';
            body.style.display = expanded ? 'none' : 'block';
            const icon = h3.querySelector('.collapse-icon');
            if (icon) icon.textContent = expanded ? '▸' : '▾';
            h3.dataset.expanded = String(!expanded);
        });
    });

    // --- Step indicator ---
    function setDesignStep(stepNum, markDone) {
        document.querySelectorAll('#design-step-indicator .step-item').forEach(el => {
            const s = parseInt(el.dataset.step);
            el.classList.toggle('active', s === stepNum);
            if (markDone && s < stepNum) {
                el.classList.add('done');
            }
        });
        document.querySelectorAll('#design-step-indicator .step-line').forEach(el => {
            const id = el.id;
            if (id === 'step-line-12') el.classList.toggle('done', stepNum >= 2);
            if (id === 'step-line-23') el.classList.toggle('done', stepNum >= 3);
        });
    }

    // --- Input validation (min/max are in US units, auto-convert for SI) ---
    const VALIDATION_RULES = {
        'design-fy':  { min: 1, max: 100, label: 'Fy', ut: 'stress' },
        'design-fu':  { min: 1, max: 120, label: 'Fu', ut: 'stress' },
        'design-KxLx': { min: 0.1, max: 10000, label: 'KxLx', ut: 'length' },
        'design-KyLy': { min: 0.1, max: 10000, label: 'KyLy', ut: 'length' },
        'design-KtLt': { min: 0.1, max: 10000, label: 'KtLt', ut: 'length' },
        'design-Lb':  { min: 0, max: 10000, label: 'Lb', ut: 'length' },
        'design-Cb':  { min: 1.0, max: 3.0, label: 'Cb', ut: null },
    };

    function validateDesignInput(id) {
        const el = document.getElementById(id);
        const rule = VALIDATION_RULES[id];
        if (!el || !rule) return true;
        const val = parseFloat(el.value);
        // min/max를 현재 단위계로 변환 (US 기준 정의)
        const minV = rule.ut ? toDisplay(rule.min, rule.ut) : rule.min;
        const maxV = rule.ut ? toDisplay(rule.max, rule.ut) : rule.max;
        const valid = !isNaN(val) && val >= minV && val <= maxV;
        el.classList.toggle('input-invalid', !valid);
        return valid;
    }

    // Validate on input
    Object.keys(VALIDATION_RULES).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => validateDesignInput(id));
    });

    // Validate Fu >= Fy
    const fyEl = document.getElementById('design-fy');
    const fuEl = document.getElementById('design-fu');
    if (fyEl && fuEl) {
        function checkFuFy() {
            const fy = parseFloat(fyEl.value) || 0;
            const fu = parseFloat(fuEl.value) || 0;
            fuEl.classList.toggle('input-invalid', fu > 0 && fu < fy);
        }
        fyEl.addEventListener('input', checkFuFy);
        fuEl.addEventListener('input', checkFuFy);
    }

    // --- Keyboard navigation (Enter → next field) ---
    const designInputs = document.querySelectorAll('#tab-design input[type="number"]');
    designInputs.forEach((inp, i) => {
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                for (let j = i + 1; j < designInputs.length; j++) {
                    if (designInputs[j].offsetParent !== null) { designInputs[j].focus(); break; }
                }
            }
        });
    });

    // --- Spec tooltip data ---
    const SPEC_TIPS = {
        'E2': 'Flexural / Torsional / Flexural-Torsional Buckling',
        'E3.2': 'DSM Local Buckling — λℓ = √(Pne/Pcrl)',
        'E3.2.1': 'DSM Local Buckling Compression Strength',
        'E4': 'DSM Distortional Buckling — λd = √(Py/Pcrd)',
        'E4.1': 'DSM Distortional Buckling Compression Strength',
        'F2': 'Lateral-Torsional Buckling — Mne = Sf × Fn',
        'F2.1': 'LTB Critical Stress Fcre',
        'F3.2': 'DSM Local Buckling Flexural Strength',
        'F3.2.1': 'DSM Local Buckling Flexural Strength',
        'F4': 'DSM Distortional Buckling Flexural Strength',
        'F4.1': 'DSM Distortional Buckling Flexural Strength',
        'G2.1': 'Shear Strength Without Transverse Stiffeners',
        'G5': 'Web Crippling Strength — Pn = Ct²Fy sin θ...',
        'H1.2': 'Combined Axial + Bending: P/Pa + Mx/Max + My/May ≤ 1.0',
        'H2': 'Combined Bending + Shear: √((M/Ma)² + (V/Va)²) ≤ 1.0',
        'H3': 'Combined Bending + Web Crippling',
        'I6.2.1': 'Through-Fastened Sheathing Uplift Reduction R',
        'D2': 'Yielding of Tension Members — Tn = Ag × Fy',
        'D3': 'Rupture of Net Section — Tn = An × Fu',
        'C1': 'Moment Amplification (P-δ effect)',
    };

    function specRefSpan(section) {
        const tip = SPEC_TIPS[section] || SPEC_TIPS[section.replace(/\.\d+$/, '')] || '';
        return '<span class="spec-ref" data-tip="' + section + ': ' + tip + '">§' + section + '</span>';
    }

    // 강재 등급 선택 시 Fy/Fu 자동 설정
    const selGrade = document.getElementById('select-steel-grade');
    if (selGrade) {
        const gradeMap = {
            // KS D 3506 (용융아연도금) — Fy/Fu in ksi (내부 US 단위)
            'SGC400': [35.53, 58.02], 'SGC440': [42.79, 63.82],
            'SGC490': [52.94, 71.08], 'SGC570': [81.22, 82.67],
            // KS D 3530 (경량형강)
            'SSC400': [35.53, 58.02],
            // ASTM
            'A653-33': [33,45], 'A653-50': [50,65], 'A653-55': [55,70], 'A653-80': [80,82],
            'A792-33': [33,45], 'A792-50': [50,65], 'A792-80': [80,82],
            'A1003-33': [33,45], 'A1003-50': [50,65],
        };
        selGrade.addEventListener('change', () => {
            const v = gradeMap[selGrade.value];
            if (v) {
                setValue('design-fy', toDisplay(v[0], 'stress'));
                setValue('design-fu', toDisplay(v[1], 'stress'));
            }
        });
    }

    // Calculator 모드 판별
    const CALC_MODES = ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'];
    function isCalcMode(t) { return CALC_MODES.includes(t); }

    // PSF/kPa → PLF/kN-m 자동 변환 (표시용)
    function updatePLF() {
        const spacingRaw = getNum('config-spacing', 4.921);
        const spacingUS = fromDisplay(spacingRaw, 'length_ft');
        ['D', 'Lr', 'S', 'Wu', 'L'].forEach(lt => {
            const psfRaw = getNum('load-' + lt + '-psf', 0);
            const psfUS = fromDisplay(psfRaw, 'pressure');
            const plfUS = psfUS * spacingUS; // plf (US)
            const plfDisp = toDisplay(plfUS, 'linload');
            const el = document.getElementById('load-' + lt + '-plf');
            if (el) el.textContent = '\u2192' + plfDisp.toFixed(unitDec('linload')) + ' ' + unitLabel('linload');
        });
    }
    ['config-spacing', 'load-D-psf', 'load-Lr-psf', 'load-S-psf', 'load-Wu-psf', 'load-L-psf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePLF);
    });
    updatePLF();

    // Span Type에 따라 테이블 동적 생성
    const selSpanType = document.getElementById('select-span-type');
    if (selSpanType) {
        function getSpanCount() {
            const st = /** @type {HTMLSelectElement} */ (selSpanType).value;
            if (st === 'simple' || st === 'cantilever') return 1;
            if (st === 'cont-n') return getNum('config-n-spans', 5);
            const m = st.match(/cont-(\d+)/);
            return m ? parseInt(m[1]) : 1;
        }

        function buildSpanTable() {
            const tbody = document.getElementById('span-config-tbody');
            if (!tbody) return;
            const n = getSpanCount();
            const st = /** @type {HTMLSelectElement} */ (selSpanType).value;
            const isSimple = (st === 'simple' || st === 'cantilever');

            let html = '';
            // 지점 수 = 스팬 수 + 1
            for (let i = 0; i <= n; i++) {
                const isEnd = (i === 0 || i === n);
                const isCantilever = (st === 'cantilever');
                const defaultSup = isCantilever ? (i === 0 ? 'F' : 'N') : (isEnd ? 'P' : 'P');
                const supOptions = '<option value="P">P (Pin)</option><option value="R">R (Roller)</option><option value="F">F (Fixed)</option><option value="N">N (Free)</option>';

                html += '<tr>';
                // 지점 번호
                html += '<td style="padding:2px;text-align:center;color:var(--vscode-descriptionForeground)">' + (i + 1) + '</td>';
                // 지점 조건
                html += '<td style="padding:1px"><select class="span-tbl-sup" data-idx="' + i + '" style="width:100%;font-size:10px;padding:1px">' + supOptions + '</select></td>';
                // 스팬 길이 (지점 i 오른쪽 스팬, 마지막 지점에는 없음)
                if (i < n) {
                    html += '<td style="padding:1px"><input type="number" class="span-tbl-len" data-idx="' + i + '" value="25" step="0.5" style="width:100%;font-size:10px;padding:1px;text-align:right"></td>';
                } else {
                    html += '<td style="padding:1px;color:#666;text-align:center">—</td>';
                }
                // Lap L (해당 지점 좌측 랩, 첫 지점은 없음)
                if (i > 0 && !isSimple) {
                    html += '<td style="padding:1px"><input type="number" class="span-tbl-lapl" data-idx="' + i + '" value="' + (isEnd ? '0' : '1.25') + '" step="0.25" style="width:100%;font-size:10px;padding:1px;text-align:right"></td>';
                } else {
                    html += '<td style="padding:1px;color:#666;text-align:center">—</td>';
                }
                // Lap R (해당 지점 우측 랩, 마지막 지점은 없음)
                if (i < n && !isSimple) {
                    html += '<td style="padding:1px"><input type="number" class="span-tbl-lapr" data-idx="' + i + '" value="' + (isEnd ? '0' : '2.75') + '" step="0.25" style="width:100%;font-size:10px;padding:1px;text-align:right"></td>';
                } else {
                    html += '<td style="padding:1px;color:#666;text-align:center">—</td>';
                }
                html += '</tr>';
            }
            tbody.innerHTML = html;

            // 캔틸레버 기본 지점조건 설정 (F-N)
            if (st === 'cantilever') {
                const supSels = tbody.querySelectorAll('.span-tbl-sup');
                supSels.forEach((el, idx) => {
                    /** @type {HTMLSelectElement} */ (el).value = (idx === 0) ? 'F' : 'N';
                });
            }

            // N-span 입력 표시
            const nInput = document.getElementById('config-n-spans');
            if (nInput) nInput.style.display = (st === 'cont-n') ? 'inline-block' : 'none';
        }

        selSpanType.addEventListener('change', buildSpanTable);
        const nSpanInput = document.getElementById('config-n-spans');
        if (nSpanInput) nSpanInput.addEventListener('change', buildSpanTable);
        buildSpanTable();
    }

    // 부재 유형에 따라 입력 필드 표시/숨김
    const selMemberType = document.getElementById('select-member-type');
    if (selMemberType) {
        function updateDesignFieldVisibility() {
            const t = selMemberType.value;
            const isCalc = isCalcMode(t);

            // Calculator 모드 섹션 표시/숨김
            const calcSection = document.getElementById('calc-mode-section');
            if (calcSection) calcSection.style.display = isCalc ? 'block' : 'none';

            // Load Analysis 결과 섹션
            const loadSection = document.getElementById('load-analysis-section');
            if (loadSection) loadSection.style.display = isCalc ? 'block' : 'none';

            // 부재 유형별 하중 행 표시 (Floor→L, Roof→Lr/S)
            const lrRow = document.getElementById('load-Lr-row');
            const sRow = document.getElementById('load-S-row');
            const wRow = document.getElementById('load-W-row');
            const lRow = document.getElementById('load-L-row');
            const isFloor = (t === 'floor-joist');
            if (lrRow) lrRow.style.display = (isCalc && !isFloor) ? 'flex' : 'none';
            if (sRow) sRow.style.display = (isCalc && !isFloor) ? 'flex' : 'none';
            if (wRow) wRow.style.display = isCalc ? 'flex' : 'none';
            if (lRow) lRow.style.display = (isCalc && isFloor) ? 'flex' : 'none';

            // Calculator에서는 flexure로 매핑
            const effectiveType = isCalc ? 'flexure' : t;
            const needsKL = (effectiveType === 'compression' || effectiveType === 'combined');
            const needsLbCb = (effectiveType === 'flexure' || effectiveType === 'combined');
            const needsLengths = needsKL || needsLbCb;

            const kxRow = document.getElementById('design-KxLx-row');
            const ktRow = document.getElementById('design-KtLt-row');
            const cbRow = document.getElementById('design-Cb-row');
            const lbRow = document.getElementById('design-Lb-row');
            const lenTitle = document.getElementById('design-lengths-title');

            const cmRow = document.getElementById('design-Cm-row');

            if (kxRow) kxRow.style.display = needsKL ? 'flex' : 'none';
            if (ktRow) ktRow.style.display = needsKL ? 'flex' : 'none';
            if (cbRow) cbRow.style.display = needsLbCb ? 'flex' : 'none';
            if (lbRow) lbRow.style.display = needsLbCb ? 'flex' : 'none';
            const wcSection = document.getElementById('design-wc-section');
            if (cmRow) cmRow.style.display = (t === 'combined') ? 'flex' : 'none';
            if (wcSection) wcSection.style.display = (t === 'flexure' || t === 'combined') ? 'block' : 'none';
            if (lenTitle) lenTitle.style.display = needsLengths ? 'block' : 'none';

            // Step indicator: hide step 2 (Loads) for direct input modes
            const step2 = document.getElementById('step-item-2');
            const line12 = document.getElementById('step-line-12');
            if (step2) step2.style.display = isCalc ? 'flex' : 'none';
            if (line12) line12.style.display = isCalc ? 'block' : 'none';
            setDesignStep(1, false);
        }
        selMemberType.addEventListener('change', updateDesignFieldVisibility);
        updateDesignFieldVisibility();
    }

    // Design 실행
    const btnDesign = document.getElementById('btn-run-design');
    if (btnDesign) {
        btnDesign.addEventListener('click', () => {
            const rawMemberType = /** @type {HTMLSelectElement} */ (document.getElementById('select-member-type'))?.value || 'compression';
            if (!model && !isCalcMode(rawMemberType)) { return; }
            const memberType = isCalcMode(rawMemberType) ? 'flexure' : rawMemberType;
            const designMethod = /** @type {HTMLSelectElement} */ (document.getElementById('select-design-method'))?.value || 'LRFD';

            const data = {
                member_type: memberType,
                design_method: designMethod,
                Fy: fromDisplay(getNum('design-fy', 52.94), 'stress'),
                Fu: fromDisplay(getNum('design-fu', 71.08), 'stress'),
                KxLx: fromDisplay(getNum('design-KxLx', 118.11), 'length'),
                KyLy: fromDisplay(getNum('design-KyLy', 118.11), 'length'),
                KtLt: fromDisplay(getNum('design-KtLt', 118.11), 'length'),
                Lb: fromDisplay(getNum('design-Lb', 118.11), 'length'),
                Cb: getNum('design-Cb', 1.0),
                Cmx: getNum('design-Cmx', 0.85),
                Cmy: getNum('design-Cmy', 0.85),
                Pu: fromDisplay(getNum('design-P', 0), 'force'),
                Mu: fromDisplay(getNum('design-Mx', 0), 'moment'),
                Mux: fromDisplay(getNum('design-Mx', 0), 'moment'),
                Muy: fromDisplay(getNum('design-My', 0), 'moment'),
                Vu: fromDisplay(getNum('design-V', 0), 'force'),
                Tu: fromDisplay(getNum('design-P', 0), 'force'),
                wc_N: fromDisplay(getNum('design-wc-N', 0), 'length'),
                wc_R: fromDisplay(getNum('design-wc-R', 0), 'radius'),
                wc_support: /** @type {HTMLSelectElement} */ (document.getElementById('design-wc-support'))?.value || 'EOF',
            };

            // Show loading
            const loadingEl = document.getElementById('design-loading');
            const summaryEl2 = document.getElementById('design-summary');
            if (loadingEl) loadingEl.style.display = 'flex';
            if (summaryEl2) summaryEl2.style.display = 'none';
            btnDesign.textContent = 'Calculating...';
            btnDesign.disabled = true;
            setDesignStep(3, true);
            vscode.postMessage({ command: 'runDesign', data });
        });
    }

    // ============================================================
    // Analyze Loads 버튼 핸들러 (Calculator 모드)
    // ============================================================
    const btnAnalyze = document.getElementById('btn-analyze-loads');
    if (btnAnalyze) {
        btnAnalyze.addEventListener('click', () => {
            const memberApp = selMemberType ? selMemberType.value : '';
            if (!isCalcMode(memberApp)) return;

            const spacing = getNum('config-spacing', 4.921);
            let spanType = /** @type {HTMLSelectElement} */ (document.getElementById('select-span-type'))?.value || 'simple';
            if (spanType === 'cont-n') {
                const n = getNum('config-n-spans', 5);
                spanType = 'cont-' + n;
            }
            // 프리프로세서 단면 템플릿 파라미터 → §I6.2.1 R 계산에 필요
            const selTemplate = document.getElementById('select-template');
            const secType = selTemplate ? selTemplate.value : '';
            // UI 입력 → US 내부값 변환 (엔진은 항상 US 단위)
            const sectionInfo = {
                depth: fromDisplay(getNum('tpl-H', 0), 'length'),
                flange_width: fromDisplay(getNum('tpl-B', 0), 'length'),
                thickness: fromDisplay(getNum('tpl-t', 0), 'thickness'),
                lip_depth: fromDisplay(getNum('tpl-D', 0), 'length'),
                R_corner: fromDisplay(getNum('tpl-r', 0), 'radius'),
                type: secType === 'lippedz' ? 'Z' : 'C',
                Fy: fromDisplay(getNum('design-fy', 52.94), 'stress'),
                Fu: fromDisplay(getNum('design-fu', 71.08), 'stress'),
                Ixx: lastProps ? lastProps.Ixx : 0,  // US in^4 (내부값)
            };

            // 테이블에서 스팬/지점/랩 데이터 수집 (→ US ft 변환)
            const spanLens = [];
            const supports = [];
            const lapsPerSupport = [];
            document.querySelectorAll('.span-tbl-len').forEach(el => {
                const raw = parseFloat(/** @type {HTMLInputElement} */ (el).value) || 25;
                spanLens.push(fromDisplay(raw, 'length_ft'));
            });
            document.querySelectorAll('.span-tbl-sup').forEach(el => {
                supports.push(/** @type {HTMLSelectElement} */ (el).value);
            });
            // 각 지점별 lap 수집
            const nSup = supports.length;
            for (let si = 0; si < nSup; si++) {
                const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + si + '"]');
                const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + si + '"]');
                const lRaw = lEl ? parseFloat(/** @type {HTMLInputElement} */ (lEl).value) || 0 : 0;
                const rRaw = rEl ? parseFloat(/** @type {HTMLInputElement} */ (rEl).value) || 0 : 0;
                lapsPerSupport.push({
                    left_ft: fromDisplay(lRaw, 'length_ft'),
                    right_ft: fromDisplay(rRaw, 'length_ft'),
                });
            }
            // 등스팬 여부 판별
            const allSame = spanLens.every(v => Math.abs(v - spanLens[0]) < 0.01);
            const spanFt = allSame ? spanLens[0] : spanLens[0];

            // spacing도 변환 (UI ft/m → US ft)
            const spacingUS = fromDisplay(spacing, 'length_ft');
            // 하중: UI psf/kPa → US plf (= psf × spacing_ft)
            const loadD_psf = fromDisplay(getNum('load-D-psf', 0), 'pressure');
            const loadLr_psf = fromDisplay(getNum('load-Lr-psf', 0), 'pressure');
            const loadS_psf = fromDisplay(getNum('load-S-psf', 0), 'pressure');
            const loadWu_psf = fromDisplay(getNum('load-Wu-psf', 0), 'pressure');
            const loadL_psf = fromDisplay(getNum('load-L-psf', 0), 'pressure');

            const data = {
                member_app: memberApp,
                span_type: spanType,
                span_ft: spanFt,
                spans_ft: spanLens,           // US ft
                supports: supports,
                laps_per_support: lapsPerSupport,
                spacing_ft: spacingUS,
                loads: {
                    D: loadD_psf * spacingUS,      // plf (US)
                    Lr: loadLr_psf * spacingUS,
                    S: loadS_psf * spacingUS,
                    W: -(loadWu_psf * spacingUS),
                    L: loadL_psf * spacingUS,
                },
                design_method: /** @type {HTMLSelectElement} */ (document.getElementById('select-design-method'))?.value || 'LRFD',
                laps: {
                    left_ft: lapsPerSupport[1]?.left_ft || 0,
                    right_ft: lapsPerSupport[1]?.right_ft || 0,
                },
                deck: {
                    type: /** @type {HTMLSelectElement} */ (document.getElementById('select-deck-type'))?.value || 'none',
                    t_panel: fromDisplay(getNum('deck-t-panel', 0.0197), 'thickness'),
                    fastener_spacing: fromDisplay(getNum('deck-fastener-spacing', 11.81), 'length'),
                    kphi_override: getNum('deck-kphi-override', null) || null,
                },
                section: (sectionInfo.depth > 0 && sectionInfo.thickness > 0) ? sectionInfo : null,
            };

            btnAnalyze.textContent = '분석 중...';
            btnAnalyze.disabled = true;
            setDesignStep(2, true);
            vscode.postMessage({ command: 'analyzeLoads', data });
        });
    }

    // 보 개략도 + 지점 조건 + 랩 구간 + 치수선 SVG
    function renderBeamSchematic(data) {
        const W = 480, H_SVG = 80, PAD_L = 20, PAD_R = 20;
        const nSpans = data.n_spans || 1;

        // 스팬 길이 배열 (부등스팬 지원)
        let spanLens = data.spans_ft || [];
        if (!spanLens.length || spanLens.length !== nSpans) {
            let totalL = 0;
            if (data.gravity && data.gravity.locations) {
                for (const loc of data.gravity.locations) {
                    if (loc.x_ft > totalL) totalL = loc.x_ft;
                }
            }
            if (totalL <= 0) return '';
            spanLens = Array(nSpans).fill(totalL / nSpans);
        }
        const totalL = spanLens.reduce((a, b) => a + b, 0);
        if (totalL <= 0) return '';

        // 지점 조건 배열
        const supports = data.supports || Array(nSpans + 1).fill('P');
        // 지점별 랩 배열
        const lapsArr = data.laps_per_support || Array(nSpans + 1).fill({left_ft: 0, right_ft: 0});

        const plotW = W - PAD_L - PAD_R;
        const beamY = 18;
        const supH = 9;
        const fg = 'var(--vscode-foreground)';
        const dim = 'var(--vscode-descriptionForeground)';
        const lapColor = '#4fc3f7';

        // ft → px 변환
        function ftToX(ft) { return PAD_L + (ft / totalL) * plotW; }

        // 지점 x 좌표 (ft 기준)
        const supFt = [0];
        for (let i = 0; i < nSpans; i++) supFt.push(supFt[i] + spanLens[i]);

        let svg = '<div style="margin:4px 0"><svg width="' + W + '" height="' + H_SVG + '" style="width:100%;max-width:' + W + 'px">';

        // (1) 보 선 (기본 두께)
        svg += '<line x1="' + ftToX(0) + '" y1="' + beamY + '" x2="' + ftToX(totalL) + '" y2="' + beamY + '" stroke="' + fg + '" stroke-width="2"/>';

        // (2) 랩 구간: 굵은 선 + 치수
        const lapDimY = beamY - 10;
        for (let i = 0; i <= nSpans; i++) {
            const lap = lapsArr[i] || {left_ft: 0, right_ft: 0};
            const lL = lap.left_ft || 0;
            const lR = lap.right_ft || 0;
            if (lL <= 0 && lR <= 0) continue;
            const sxFt = supFt[i];
            const x1Ft = Math.max(0, sxFt - lL);
            const x2Ft = Math.min(totalL, sxFt + lR);
            const x1 = ftToX(x1Ft);
            const x2 = ftToX(x2Ft);
            // 굵은 오버레이 선
            svg += '<line x1="' + x1.toFixed(1) + '" y1="' + beamY + '" x2="' + x2.toFixed(1) + '" y2="' + beamY + '" stroke="' + lapColor + '" stroke-width="5" stroke-opacity="0.5"/>';
            // 랩 치수선 (보 위쪽)
            const lapTotal = lL + lR;
            if (lapTotal > 0) {
                svg += '<line x1="' + x1.toFixed(1) + '" y1="' + lapDimY + '" x2="' + x2.toFixed(1) + '" y2="' + lapDimY + '" stroke="' + lapColor + '" stroke-width="0.7"/>';
                svg += '<line x1="' + x1.toFixed(1) + '" y1="' + (lapDimY-2) + '" x2="' + x1.toFixed(1) + '" y2="' + (lapDimY+2) + '" stroke="' + lapColor + '" stroke-width="0.7"/>';
                svg += '<line x1="' + x2.toFixed(1) + '" y1="' + (lapDimY-2) + '" x2="' + x2.toFixed(1) + '" y2="' + (lapDimY+2) + '" stroke="' + lapColor + '" stroke-width="0.7"/>';
                svg += '<text x="' + ((x1+x2)/2).toFixed(1) + '" y="' + (lapDimY-2) + '" fill="' + lapColor + '" font-size="8" text-anchor="middle">' + fmtVal(lapTotal, 'length_ft') + ' ' + unitLabel('length_ft') + ' lap</text>';
            }
        }

        // (3) 지점 그래픽 (P/R/F 구분)
        for (let i = 0; i <= nSpans; i++) {
            const x = ftToX(supFt[i]);
            const type = (supports[i] || 'P').toUpperCase().charAt(0);
            const tw = 6; // 삼각형 반폭
            if (type === 'N') {
                // 자유단(Free end): 작은 원 (지지 없음 표시)
                svg += '<circle cx="' + x + '" cy="' + beamY + '" r="3" fill="none" stroke="' + fg + '" stroke-width="1.2" stroke-dasharray="2,1"/>';
            } else if (type === 'F') {
                // 고정단: 채워진 삼각형 + 수직선 + 해치
                svg += '<polygon points="' + x + ',' + beamY + ' ' + (x-tw) + ',' + (beamY+supH) + ' ' + (x+tw) + ',' + (beamY+supH) + '" fill="' + fg + '" fill-opacity="0.7"/>';
                svg += '<line x1="' + (x-tw-1) + '" y1="' + (beamY+supH) + '" x2="' + (x+tw+1) + '" y2="' + (beamY+supH) + '" stroke="' + fg + '" stroke-width="2"/>';
                for (let h = -tw; h <= tw; h += 3) {
                    svg += '<line x1="' + (x+h) + '" y1="' + (beamY+supH) + '" x2="' + (x+h-2) + '" y2="' + (beamY+supH+4) + '" stroke="' + fg + '" stroke-width="0.7" stroke-opacity="0.5"/>';
                }
            } else if (type === 'R') {
                // 롤러: 삼각형 + 원 (이동 가능)
                svg += '<polygon points="' + x + ',' + beamY + ' ' + (x-tw) + ',' + (beamY+supH-2) + ' ' + (x+tw) + ',' + (beamY+supH-2) + '" fill="' + fg + '" fill-opacity="0.5" stroke="' + fg + '" stroke-width="0.5"/>';
                svg += '<circle cx="' + x + '" cy="' + (beamY+supH+1) + '" r="2.5" fill="none" stroke="' + fg + '" stroke-width="1"/>';
            } else {
                // 핀: 삼각형 + 수평선
                svg += '<polygon points="' + x + ',' + beamY + ' ' + (x-tw) + ',' + (beamY+supH) + ' ' + (x+tw) + ',' + (beamY+supH) + '" fill="' + fg + '" fill-opacity="0.5" stroke="' + fg + '" stroke-width="0.5"/>';
                svg += '<line x1="' + (x-tw-1) + '" y1="' + (beamY+supH+1) + '" x2="' + (x+tw+1) + '" y2="' + (beamY+supH+1) + '" stroke="' + fg + '" stroke-width="1"/>';
            }
            // 지점 라벨
            svg += '<text x="' + x.toFixed(1) + '" y="' + (beamY+supH+12) + '" fill="' + dim + '" font-size="8" text-anchor="middle">' + type + '</text>';
        }

        // (4) 스팬별 치수선
        const dimY = beamY + supH + 18;
        for (let i = 0; i < nSpans; i++) {
            const x1 = ftToX(supFt[i]);
            const x2 = ftToX(supFt[i + 1]);
            const midX = (x1 + x2) / 2;
            svg += '<line x1="' + x1.toFixed(1) + '" y1="' + dimY + '" x2="' + x2.toFixed(1) + '" y2="' + dimY + '" stroke="' + dim + '" stroke-width="0.8"/>';
            svg += '<line x1="' + x1.toFixed(1) + '" y1="' + (dimY-3) + '" x2="' + x1.toFixed(1) + '" y2="' + (dimY+3) + '" stroke="' + dim + '" stroke-width="0.8"/>';
            svg += '<line x1="' + x2.toFixed(1) + '" y1="' + (dimY-3) + '" x2="' + x2.toFixed(1) + '" y2="' + (dimY+3) + '" stroke="' + dim + '" stroke-width="0.8"/>';
            svg += '<text x="' + midX.toFixed(1) + '" y="' + (dimY+11) + '" fill="' + dim + '" font-size="9" text-anchor="middle">' + fmtVal(spanLens[i], 'length_ft') + ' ' + unitLabel('length_ft') + '</text>';
        }

        svg += '</svg></div>';
        return svg;
    }

    // M/V 다이어그램 SVG 렌더링 (확대 + 지점마커 + max/min 라벨)
    function renderDiagramSVG(values, label, color, flipSign) {
        const W = 480, H = 110, PAD_L = 6, PAD_R = 6, PAD_T = 18, PAD_B = 16;
        const n = values.length;
        if (n < 2) return '';

        const vals = flipSign ? values.map(v => -v) : values;
        const maxAbs = Math.max(...vals.map(v => Math.abs(v)), 0.001);
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;
        const scaleX = plotW / (n - 1);
        const scaleY = (plotH / 2) / maxAbs;
        const midY = PAD_T + plotH / 2;

        let pathD = '';
        let maxI = 0, minI = 0;
        for (let i = 0; i < n; i++) {
            const x = PAD_L + i * scaleX;
            const y = midY - vals[i] * scaleY;
            pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
            if (vals[i] > vals[maxI]) maxI = i;
            if (vals[i] < vals[minI]) minI = i;
        }

        let fillD = pathD + 'L' + (PAD_L + (n-1)*scaleX).toFixed(1) + ',' + midY + 'L' + PAD_L + ',' + midY + 'Z';

        // Max/min labels
        const maxX = PAD_L + maxI * scaleX;
        const maxY = midY - vals[maxI] * scaleY;
        const minX = PAD_L + minI * scaleX;
        const minY = midY - vals[minI] * scaleY;
        const origMax = flipSign ? -vals[maxI] : vals[maxI];
        const origMin = flipSign ? -vals[minI] : vals[minI];

        let svg = '<div style="margin:4px 0"><svg width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:3px">';
        // baseline + support markers
        svg += '<line x1="' + PAD_L + '" y1="' + midY + '" x2="' + (W-PAD_R) + '" y2="' + midY + '" stroke="var(--vscode-foreground)" stroke-opacity="0.25" stroke-dasharray="4"/>';
        if (_lastLoadAnalysis) {
            const ns = _lastLoadAnalysis.n_spans || 1;
            const sft = _lastLoadAnalysis.spans_ft;
            const totalLft = sft ? sft.reduce((a,b) => a+b, 0) : 0;
            if (sft && totalLft > 0) {
                let cumFt = 0;
                for (let si = 0; si <= ns; si++) {
                    const sx = PAD_L + (cumFt / totalLft) * plotW;
                    svg += '<line x1="' + sx.toFixed(1) + '" y1="' + (midY - 3) + '" x2="' + sx.toFixed(1) + '" y2="' + (midY + 3) + '" stroke="var(--vscode-foreground)" stroke-opacity="0.4" stroke-width="1"/>';
                    if (si < ns) cumFt += sft[si];
                }
            } else {
                for (let si = 0; si <= ns; si++) {
                    const sx = PAD_L + (si / ns) * plotW;
                    svg += '<line x1="' + sx.toFixed(1) + '" y1="' + (midY - 3) + '" x2="' + sx.toFixed(1) + '" y2="' + (midY + 3) + '" stroke="var(--vscode-foreground)" stroke-opacity="0.4" stroke-width="1"/>';
                }
            }
        }
        // fill + line
        svg += '<path d="' + fillD + '" fill="' + color + '" fill-opacity="0.12"/>';
        svg += '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>';
        // title
        svg += '<text x="' + PAD_L + '" y="13" fill="var(--vscode-foreground)" font-size="10" font-weight="600">' + label + '</text>';
        // max/min value labels on diagram
        if (Math.abs(vals[maxI]) > 0.01) {
            svg += '<circle cx="' + maxX.toFixed(1) + '" cy="' + maxY.toFixed(1) + '" r="2.5" fill="' + color + '"/>';
            svg += '<text x="' + (maxX + 3).toFixed(1) + '" y="' + (maxY - 4).toFixed(1) + '" fill="' + color + '" font-size="9" font-weight="600">' + origMax.toFixed(1) + '</text>';
        }
        if (Math.abs(vals[minI]) > 0.01 && minI !== maxI) {
            svg += '<circle cx="' + minX.toFixed(1) + '" cy="' + minY.toFixed(1) + '" r="2.5" fill="#ff8a65"/>';
            svg += '<text x="' + (minX + 3).toFixed(1) + '" y="' + (minY + 11).toFixed(1) + '" fill="#ff8a65" font-size="9" font-weight="600">' + origMin.toFixed(1) + '</text>';
        }
        // footer
        svg += '<text x="' + (W - PAD_R) + '" y="' + (H - 2) + '" fill="var(--vscode-descriptionForeground)" font-size="9" text-anchor="end">max=' + Math.max(...values).toFixed(1) + '  min=' + Math.min(...values).toFixed(1) + '</text>';
        svg += '</svg></div>';
        return svg;
    }

    // Analyze Loads 결과 렌더링
    function renderLoadAnalysisResult(data) {
        const el = document.getElementById('load-analysis-result');
        if (!el) return;

        if (data.error) {
            el.innerHTML = '<p style="color:var(--vscode-errorForeground)">' + data.error + '</p>';
            return;
        }

        _lastLoadAnalysis = data;
        let html = '';

        // Beam schematic with dimension lines
        if (data.gravity && data.gravity.M_diagram && data.gravity.M_diagram.length > 2) {
            html += renderBeamSchematic(data);
        }

        // M Diagram SVG
        if (data.gravity && data.gravity.M_diagram && data.gravity.M_diagram.length > 2) {
            const mLabel = 'Moment (' + unitLabel('moment_ft') + ')';
            const mVals = _unitSystem === 'SI'
                ? data.gravity.M_diagram.map(v => toDisplay(v, 'moment_ft'))
                : data.gravity.M_diagram;
            html += renderDiagramSVG(mVals, mLabel, '#4fc3f7', true);
        }

        // V Diagram SVG
        if (data.gravity && data.gravity.V_diagram && data.gravity.V_diagram.length > 2) {
            const vLabel = 'Shear (' + unitLabel('force') + ')';
            const vVals = _unitSystem === 'SI'
                ? data.gravity.V_diagram.map(v => toDisplay(v, 'force'))
                : data.gravity.V_diagram;
            html += renderDiagramSVG(vVals, vLabel, '#ff8a65', false);
        }

        // 중력 지배 결과
        if (data.gravity) {
            const mU = unitLabel('moment_ft'), fU = unitLabel('force');
            html += '<strong>Gravity: ' + data.gravity.combo + '</strong>';
            html += '<table style="width:100%;font-size:11px;margin:4px 0"><tr style="background:var(--vscode-editor-selectionBackground)"><th>Location</th><th>Mu(' + mU + ')</th><th>Vu(' + fU + ')</th><th>Ru(' + fU + ')</th></tr>';
            for (const loc of data.gravity.locations) {
                const m = fmtVal(loc.Mu, 'moment_ft');
                const v = fmtVal(loc.Vu, 'force');
                const r = fmtVal(loc.Ru, 'force');
                html += '<tr><td>' + loc.name + '</td><td>' + m + '</td><td>' + v + '</td><td>' + r + '</td></tr>';
            }
            html += '</table>';
        }

        // 양력 결과
        if (data.uplift) {
            html += '<strong>Uplift: ' + data.uplift.combo + '</strong>';
            html += '<table style="width:100%;font-size:11px;margin:4px 0"><tr style="background:var(--vscode-editor-selectionBackground)"><th>Location</th><th>Mu(' + unitLabel('moment_ft') + ')</th></tr>';
            for (const loc of data.uplift.locations) {
                const m = fmtVal(loc.Mu, 'moment_ft');
                html += '<tr><td>' + loc.name + '</td><td>' + m + '</td></tr>';
            }
            html += '</table>';
        }

        // ── 하중조합 상세 결과 ──
        if (data.all_combos_detail && data.all_combos_detail.length > 0) {
            const mU = _rul('moment_ft'), fU = _rul('force');
            const plf = data.input_loads_plf || {};
            const dm = data.design_method || 'LRFD';

            // 입력 하중 요약
            html += '<div style="margin-top:8px;padding:6px;border:1px solid var(--vscode-panel-border);border-radius:3px;font-size:11px">';
            html += '<strong>입력 하중 (' + _rul('linload') + ')</strong><br>';
            const loadLabels = {D:'고정(D)',Lr:'지붕활(Lr)',S:'적설(S)',L:'활(L)',W:'풍(W)',E:'지진(E)',R:'우수(R)'};
            for (const [k, v] of Object.entries(plf)) {
                html += '<span style="margin-right:8px"><b>' + (loadLabels[k]||k) + '</b> = ' + fmtVal(Math.abs(v), 'linload') + '</span>';
            }
            html += '</div>';

            // 조합 상세 테이블
            html += '<div style="margin-top:6px;font-size:10px">';
            html += '<strong>' + dm + ' 하중조합 상세 (ASCE 7)</strong>';
            html += '<table style="width:100%;font-size:10px;margin:4px 0;border-collapse:collapse">';
            html += '<tr style="background:var(--vscode-editor-selectionBackground)">';
            html += '<th style="padding:2px 4px;text-align:left">조합</th>';
            html += '<th style="padding:2px 4px">조합 수식</th>';
            html += '<th style="padding:2px 4px">|M|<sub>max</sub></th>';
            html += '<th style="padding:2px 4px">|V|<sub>max</sub></th>';
            html += '<th style="padding:2px 4px">지배</th>';
            html += '</tr>';

            data.all_combos_detail.forEach(cd => {
                const isGov = cd.governs_gravity || cd.governs_uplift;
                const bg = isGov ? 'background:rgba(76,175,80,0.12);font-weight:600' : '';

                // 조합 수식 생성: "1.2×15 + 1.6×90 = ..." 형태
                let formula = '';
                const terms = [];
                for (const [lt, factor] of Object.entries(cd.factors)) {
                    const w = plf[lt];
                    if (w == null) continue;
                    const wAbs = Math.abs(w);
                    const fStr = factor === 1.0 ? '' : factor + '×';
                    const wDisp = fmtVal(wAbs, 'linload');
                    terms.push('<b>' + fStr + '</b>' + (loadLabels[lt]||lt) + '(' + wDisp + ')');
                }
                formula = terms.join(' + ');

                html += '<tr style="' + bg + '">';
                html += '<td style="padding:2px 4px;white-space:nowrap">' + cd.name + '</td>';
                html += '<td style="padding:2px 4px">' + formula + '</td>';
                html += '<td style="padding:2px 4px;text-align:right"><b>' + fmtVal(cd.max_abs_M, 'moment_ft') + '</b></td>';
                html += '<td style="padding:2px 4px;text-align:right">' + fmtVal(cd.max_abs_V, 'force') + '</td>';
                html += '<td style="padding:2px 4px;text-align:center">';
                if (cd.governs_gravity) html += '<span style="color:#4caf50">중력▲</span>';
                if (cd.governs_uplift) html += '<span style="color:#ff9800">양력▼</span>';
                html += '</td>';
                html += '</tr>';
            });
            html += '</table></div>';
        }

        // 처짐 다이어그램 & 스팬별 최대 처짐
        if (data.deflection && data.deflection.D_diagram && data.deflection.D_diagram.length > 2) {
            const dVals = _unitSystem === 'SI'
                ? data.deflection.D_diagram.map(v => toDisplay(v, 'length'))
                : data.deflection.D_diagram;
            html += renderDiagramSVG(dVals, '처짐 (' + _rul('length') + ') — ' + data.deflection.combo, '#66bb6a', false);

            if (data.deflection.per_span && data.deflection.per_span.length > 0) {
                const lU = _rul('length_ft'), dU = _rul('length');
                html += '<table style="width:100%;font-size:11px;margin:4px 0"><tr style="background:var(--vscode-editor-selectionBackground)"><th>스팬</th><th>위치('+lU+')</th><th>최대처짐('+dU+')</th><th>L/δ</th></tr>';
                for (const ps of data.deflection.per_span) {
                    const xVal = fmtVal(ps.x_ft, 'length_ft');
                    const dVal = fmtVal(ps.abs_delta_in, 'length');
                    const ld = ps.L_over_delta === Infinity ? '∞' : ps.L_over_delta.toFixed(0);
                    html += '<tr><td>' + ps.span + '</td><td>' + xVal + '</td><td>' + dVal + '</td><td>L/' + ld + '</td></tr>';
                }
                html += '</table>';
            }
        }

        // Auto params
        if (data.auto_params) {
            const ap = data.auto_params;
            html += '<div style="font-size:11px;margin-top:6px;padding:4px;border:1px solid var(--vscode-panel-border);border-radius:3px">';
            html += '<strong>Auto Parameters:</strong><br>';
            if (ap.deck) html += 'Deck: k&phi;=' + ap.deck.kphi + ', kx=' + ap.deck.kx + '<br>';
            if (ap.positive_region) html += 'Positive: braced=' + ap.positive_region.braced + '<br>';
            if (ap.negative_region) html += 'Negative: Ly=' + fmtVal(ap.negative_region.Ly_in, 'length') + ' ' + unitLabel('length') + ', Cb=' + ap.negative_region.Cb + '<br>';
            if (ap.uplift_R != null) html += 'Uplift R=' + ap.uplift_R;
            html += '</div>';

            // Auto-fill required strengths into design inputs
            if (data.gravity && data.gravity.locations.length > 0) {
                // 절대값 최대 Mu 위치
                let maxLoc = data.gravity.locations[0];
                for (const loc of data.gravity.locations) {
                    if (loc.Mu != null && Math.abs(loc.Mu) > Math.abs(maxLoc.Mu || 0)) maxLoc = loc;
                }
                // US 내부값 → 표시값 변환하여 입력 필드에 설정
                if (maxLoc.Mu != null) {
                    const mu_kipIn = Math.abs(maxLoc.Mu * 12); // kip-ft → kip-in (US)
                    setValue('design-Mx', toDisplay(mu_kipIn, 'moment').toFixed(unitDec('moment')));
                }
                if (maxLoc.Vu != null) setValue('design-V', toDisplay(maxLoc.Vu, 'force').toFixed(unitDec('force')));
                // Unbraced lengths
                if (ap.negative_region) {
                    setValue('design-Lb', toDisplay(ap.negative_region.Ly_in || 0, 'length').toFixed(unitDec('length')));
                    setValue('design-Cb', ap.negative_region.Cb || 1.0);
                }
            }
        }

        el.innerHTML = html;

        // 버튼 복원
        if (btnAnalyze) {
            btnAnalyze.textContent = '📊 하중 분석 실행';
            btnAnalyze.disabled = false;
        }
    }

    // Copy Report 버튼
    let _lastReport = '';
    const btnCopyReport = document.getElementById('btn-copy-report');
    if (btnCopyReport) {
        btnCopyReport.addEventListener('click', () => {
            if (_lastReport) {
                navigator.clipboard.writeText(_lastReport).then(() => {
                    btnCopyReport.textContent = '복사 완료!';
                    setTimeout(() => { btnCopyReport.textContent = '보고서 클립보드 복사'; }, 1500);
                });
            }
        });
    }

    // 설계 결과 렌더링
    function renderDesignResult(data) {
        if (!data) { return; }
        const summaryEl = document.getElementById('design-summary');
        const stepsEl = document.getElementById('design-steps');
        const interTitle = document.getElementById('design-interaction-title');
        const interEl = document.getElementById('design-interaction');
        const refEl = document.getElementById('design-reference');

        // Hide loading, restore button
        const loadingEl = document.getElementById('design-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        if (summaryEl) summaryEl.style.display = 'block';
        if (btnDesign) { btnDesign.textContent = '▶ 설계 검토 실행'; btnDesign.disabled = false; }

        if (!summaryEl || !stepsEl) { return; }

        // 에러 처리
        if (data.error) {
            summaryEl.innerHTML = `<p style="color:var(--vscode-errorForeground)">${data.error}</p>`;
            stepsEl.innerHTML = '';
            return;
        }

        // --- Summary with Strength Cards + Gauge ---
        const mt = data.member_type || '';
        const mode = data.controlling_mode || '';
        const dm = data.design_method || 'LRFD';
        const pass = data.pass;
        const util = data.utilization;

        let summaryHtml = '';

        // Strength comparison cards for compression/flexure
        if (mt === 'compression' || mt === 'flexure') {
            const isC = mt === 'compression';
            const vals = isC
                ? [{l:'Global',k:'Pne',v:data.Pne},{l:'Local',k:'Pnl',v:data.Pnl},{l:'Distort.',k:'Pnd',v:data.Pnd}]
                : [{l:'Global',k:'Mne',v:data.Mne},{l:'Local',k:'Mnl',v:data.Mnl},{l:'Distort.',k:'Mnd',v:data.Mnd}];
            const uType = isC ? 'force' : 'moment';
            const unit = unitLabel(uType);
            const nominal = isC ? data.Pn : data.Mn;
            const designVal = dm === 'LRFD' ? (isC ? data.phi_Pn : data.phi_Mn) : (isC ? data.Pn_omega : data.Mn_omega);
            const designLabel = dm === 'LRFD' ? (isC ? 'φPn' : 'φMn') : (isC ? 'Pn/Ω' : 'Mn/Ω');

            summaryHtml += '<div class="strength-cards">';
            vals.forEach(v => {
                const gov = (v.v != null && nominal != null && Math.abs(v.v - nominal) < 0.01) ? ' governing' : '';
                summaryHtml += '<div class="strength-card' + gov + '">';
                summaryHtml += '<div class="sc-label">' + v.l + '</div>';
                summaryHtml += '<div class="sc-value">' + (v.v != null ? fmtVal(v.v, uType) : '-') + '</div>';
                summaryHtml += '<div class="sc-label">' + unit + '</div>';
                if (gov) summaryHtml += '<div><span class="governing-badge">지배</span></div>';
                summaryHtml += '</div>';
            });
            summaryHtml += '</div>';

            summaryHtml += '<div style="font-size:12px;margin:4px 0">';
            summaryHtml += '<b style="color:#4fc3f7">' + designLabel + ' = ' + (designVal != null ? fmtVal(designVal, uType) : '-') + ' ' + unit + '</b>';
            summaryHtml += ' <span style="color:var(--vscode-descriptionForeground)">(' + mode + ')</span>';
            summaryHtml += '</div>';
        } else if (mt === 'tension') {
            const fU = unitLabel('force');
            summaryHtml += '<table style="width:100%;font-size:12px">';
            summaryHtml += _summaryRow('Tn (항복)', data.Tn_yield, fU, null, 'force');
            summaryHtml += _summaryRow('Tn (파단)', data.Tn_rupture, fU, null, 'force');
            summaryHtml += _summaryRow('지배 모드', mode, '');
            summaryHtml += _summaryRow('설계강도', data.design_strength, fU, '#4fc3f7', 'force');
            summaryHtml += '</table>';
        } else if (mt === 'combined') {
            const c = data.compression || {};
            const f = data.flexure_x || {};
            const fy2 = data.flexure_y || null;
            const fU = unitLabel('force'), mU = unitLabel('moment');
            summaryHtml += '<table style="width:100%;font-size:12px">';
            summaryHtml += _summaryRow('Pn (' + (c.controlling_mode||'') + ')', c.Pn, fU, null, 'force');
            summaryHtml += _summaryRow('설계 Pn', c.design_strength, fU, '#4fc3f7', 'force');
            summaryHtml += _summaryRow('Mn(x) (' + (f.controlling_mode||'') + ')', f.Mn, mU, null, 'moment');
            summaryHtml += _summaryRow('설계 Mn(x)', f.design_strength, mU, '#4fc3f7', 'moment');
            if (fy2) {
                summaryHtml += _summaryRow('Mn(y)', fy2.Mn, mU, null, 'moment');
                summaryHtml += _summaryRow('설계 Mn(y)', fy2.design_strength, mU, '#4fc3f7', 'moment');
            }
            if (data.amplification) {
                summaryHtml += _summaryRow('§C1 αx', data.amplification.alpha_x?.toFixed(3), '', '#ffab00');
                summaryHtml += _summaryRow('§C1 αy', data.amplification.alpha_y?.toFixed(3), '', '#ffab00');
            }
            if (data.shear) {
                summaryHtml += _summaryRow('Vn', data.shear.Vn, fU, null, 'force');
                summaryHtml += _summaryRow('설계 Vn', data.shear.design_strength, fU, '#4fc3f7', 'force');
            }
            summaryHtml += '</table>';
        } else if (mt === 'connection') {
            const ls = data.limit_states || [];
            const fU = unitLabel('force');
            summaryHtml += '<table style="width:100%;font-size:12px">';
            ls.forEach(l => {
                const mark = l.governs ? ' <span class="governing-badge">지배</span>' : '';
                summaryHtml += _summaryRow(l.name + mark, l.design_strength, fU, l.governs ? '#ffab00' : undefined, 'force');
            });
            summaryHtml += _summaryRow('설계강도', data.design_strength, fU, '#4fc3f7', 'force');
            summaryHtml += '</table>';
        }

        // 이용률 게이지 바
        if (util != null) {
            const pct = Math.min(util * 100, 120).toFixed(0);
            const cls = util <= 0.75 ? 'ok' : (util <= 1.0 ? 'warn' : 'fail');
            summaryHtml += '<div class="utilization-bar">';
            summaryHtml += '<div class="utilization-fill ' + cls + '" style="width:' + Math.min(pct, 100) + '%"></div>';
            summaryHtml += '<span class="utilization-label">' + pct + '% ' + (pass ? '✓ OK' : '✗ NG') + '</span>';
            summaryHtml += '</div>';
        }

        summaryEl.innerHTML = summaryHtml;

        // --- Steps as cards ---
        const steps = data.steps || [];
        let stepsHtml = '';
        if (steps.length > 0) {
            steps.forEach(s => {
                const isGov = !!s.controlling_mode;
                stepsHtml += '<div class="calc-step' + (isGov ? ' governing' : '') + '">';
                stepsHtml += '<div class="calc-step-header">';
                stepsHtml += '<span>' + s.step + '. ' + s.name + '</span>';
                stepsHtml += '<span>';
                if (isGov) stepsHtml += '<span class="governing-badge">지배</span>';
                if (s.equation) stepsHtml += '<span class="calc-step-ref">' + specRefSpan(s.equation) + '</span>';
                stepsHtml += '</span></div>';
                if (s.formula) stepsHtml += '<div style="color:var(--vscode-descriptionForeground);font-size:11px">' + s.formula + '</div>';
                if (s.value != null) {
                    const sut = _mapUSUnit(s.unit);
                    const sv = sut ? fmtVal(s.value, sut) : s.value;
                    const su = sut ? unitLabel(sut) : (s.unit || '');
                    stepsHtml += '<div class="calc-step-value">' + sv + ' ' + su + '</div>';
                }
                stepsHtml += '</div>';
            });
        } else if (data.limit_states) {
            data.limit_states.forEach((ls, i) => {
                const isGov = !!ls.governs;
                stepsHtml += '<div class="calc-step' + (isGov ? ' governing' : '') + '">';
                stepsHtml += '<div class="calc-step-header">';
                stepsHtml += '<span>' + (i+1) + '. ' + ls.name + '</span>';
                stepsHtml += '<span>';
                if (isGov) stepsHtml += '<span class="governing-badge">지배</span>';
                if (ls.equation) stepsHtml += '<span class="calc-step-ref">' + specRefSpan(ls.equation) + '</span>';
                stepsHtml += '</span></div>';
                if (ls.formula) stepsHtml += '<div style="color:var(--vscode-descriptionForeground);font-size:11px">' + ls.formula + '</div>';
                stepsHtml += '<div>Rn = <b>' + fmtVal(ls.Rn, 'force') + '</b> ' + unitLabel('force') + ' → <span class="calc-step-value">' + fmtVal(ls.design_strength, 'force') + ' ' + unitLabel('force') + '</span></div>';
                stepsHtml += '</div>';
            });
        }
        stepsEl.innerHTML = stepsHtml || '<p class="hint">No steps</p>';

        // --- Interaction ---
        if (data.interaction) {
            if (interTitle) { interTitle.style.display = 'block'; }
            if (interEl) {
                interEl.style.display = 'block';
                const ir = data.interaction;
                const clr = ir.pass ? '#4caf50' : '#ff5252';
                interEl.innerHTML = `
                    <table style="width:100%;font-size:12px">
                        ${_summaryRow('P/Pa', ir.P_ratio?.toFixed(3), '')}
                        ${_summaryRow('Mx/Max', ir.Mx_ratio?.toFixed(3), '')}
                        ${_summaryRow('My/May', ir.My_ratio?.toFixed(3), '')}
                        ${_summaryRow('Total', ir.total?.toFixed(3), '≤ 1.0', clr)}
                        ${_summaryRow('Result', ir.pass ? 'OK' : 'NG', '', clr)}
                    </table>
                    <p style="font-size:11px;color:#888">Eq. ${ir.equation}</p>`;
            }
        } else {
            if (interTitle) { interTitle.style.display = 'none'; }
            if (interEl) { interEl.style.display = 'none'; }
        }

        // --- H3 Web Crippling + Bending Interaction ---
        if (data.h3_interaction && interEl) {
            if (interTitle) { interTitle.style.display = 'block'; }
            interEl.style.display = 'block';
            const h3 = data.h3_interaction;
            const wc = data.web_crippling || {};
            const h3clr = h3.pass ? '#4caf50' : '#ff5252';
            interEl.innerHTML += `
                <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--vscode-panel-border,#333)">
                <b>Web Crippling + Bending (§H3)</b>
                <table style="width:100%;font-size:12px;margin-top:4px">
                    ${_summaryRow('Pn (web crippling)', wc.Pn, _rul('force'), '', 'force')}
                    ${_summaryRow('Support', wc.support, '')}
                    ${_summaryRow('0.91(P/Pn)', h3.P_term?.toFixed(3), '')}
                    ${_summaryRow('M/Mnfo', h3.M_term?.toFixed(3), '')}
                    ${_summaryRow('Total', h3.total?.toFixed(3), '≤ ' + h3.limit?.toFixed(2), h3clr)}
                    ${_summaryRow('Result', h3.pass ? 'OK' : 'NG', '', h3clr)}
                </table>
                <p style="font-size:11px;color:#888">Eq. ${h3.equation}</p>
                </div>`;
        }

        // --- Reference with tooltips ---
        if (refEl) {
            const sections = data.spec_sections || [];
            let refHtml = sections.length > 0
                ? '<p>AISI S100-16: ' + sections.map(s => specRefSpan(s)).join(' &nbsp;') + '</p>'
                : '<p class="hint">No specification sections referenced</p>';

            // DSM 적용 한계 경고
            const warnings = data.dsm_warnings || [];
            if (warnings.length > 0) {
                refHtml += `<div style="margin-top:6px;padding:6px;background:rgba(255,87,34,0.15);border-radius:4px">`;
                refHtml += `<b style="color:#ff5722">DSM Applicability Warnings:</b><ul style="margin:4px 0;padding-left:20px">`;
                warnings.forEach(w => { refHtml += `<li style="color:#ffab00;font-size:11px">${w}</li>`; });
                refHtml += `</ul></div>`;
            }
            refEl.innerHTML = refHtml;
        }

        // Report 저장 + 버튼 표시
        _lastReport = data.report || '';
        if (btnCopyReport) {
            btnCopyReport.style.display = _lastReport ? 'block' : 'none';
        }
    }

    function _summaryRow(label, value, unit, color, unitType) {
        const style = color ? ' style="color:' + color + '"' : '';
        const dispVal = (unitType && typeof value === 'number') ? fmtVal(value, unitType) : (value ?? '-');
        return '<tr><td style="padding:2px 6px;color:#aaa">' + label + '</td>' +
               '<td style="padding:2px 6px;text-align:right"' + style + '><b>' + dispVal + '</b> ' + (unit || '') + '</td></tr>';
    }

    /** US 단위 문자열 → unitType 매핑 (Python step.unit → UNIT key) */
    function _mapUSUnit(u) {
        if (!u) return null;
        const map = {
            'kips': 'force', 'kip': 'force', 'kN': 'force',
            'kip-in': 'moment', 'kN-m': 'moment',
            'kip-ft': 'moment_ft',
            'ksi': 'stress', 'MPa': 'stress',
            'in': 'length', 'mm': 'length',
            'ft': 'length_ft', 'm': 'length_ft',
            'in^2': 'area', 'in²': 'area', 'mm²': 'area',
            'in^3': 'modulus', 'in³': 'modulus', 'mm³': 'modulus',
            'in^4': 'inertia', 'in⁴': 'inertia', 'mm⁴': 'inertia',
        };
        return map[u] || null;
    }

    // ============================================================
    // Report 탭 — 상세 리포트 생성
    // ============================================================

    const btnGenReport = document.getElementById('btn-generate-report');
    const btnPrintReport = document.getElementById('btn-print-report');
    const reportContainer = document.getElementById('report-container');

    if (btnGenReport) {
        btnGenReport.addEventListener('click', () => {
            if (!_lastDesignResult && !_lastLoadAnalysis) {
                if (reportContainer) reportContainer.innerHTML = '<p style="color:var(--vscode-errorForeground);text-align:center;padding:20px">설계 결과가 없습니다. 먼저 "하중 분석 실행"과 "설계 검토 실행"을 수행하세요.</p>';
                return;
            }
            if (reportContainer) {
                reportContainer.innerHTML = generateDetailedReport();
                if (btnPrintReport) btnPrintReport.style.display = 'inline-block';
            }
        });
    }

    if (btnPrintReport) {
        btnPrintReport.addEventListener('click', () => {
            if (!reportContainer) return;
            const w = window.open('', '_blank');
            if (!w) return;
            w.document.write(`<!DOCTYPE html><html><head><title>CUFSM Design Report</title>
            <style>
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
                .pass{color:#2e7d32;font-weight:700} .fail{color:#c62828;font-weight:700}
                .section-fig{text-align:center;margin:12px 0}
                svg text{font-family:'Segoe UI',sans-serif}
                hr{margin:16px 0;border:none;border-top:1px solid #ddd}
                @media print{body{font-size:10px;line-height:1.6} .no-print{display:none} h2{page-break-before:auto}}
            </style></head><body>${reportContainer.innerHTML}</body></html>`);
            w.document.close();
            w.print();
        });
    }

    // ─── Report utility ───
    function _rv(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 2) : '—'; }
    /** Report용 단위 변환 값 포맷: _ruv(value, unitType) */
    function _ruv(v, ut) { return fmtVal(v, ut); }
    /** Report용 단위 라벨: _rul(unitType) */
    function _rul(ut) { return unitLabel(ut); }

    function generateDetailedReport() {
        const d = _lastDesignResult;
        const la = _lastLoadAnalysis;
        const now = new Date().toLocaleString();
        let h = '', sec = 0;

        // ── Header ──
        h += '<h1>CUFSM — 냉간성형강 설계 보고서</h1>';
        h += '<table style="border:none"><tr style="border:none"><td style="border:none;width:50%">날짜: '+now+'</td>';
        h += '<td style="border:none;text-align:right">AISI S100-16 / 직접강도법 (DSM)</td></tr></table><hr>';

        // ── 1. 단면 ──
        h += '<h2>'+(++sec)+'. 단면</h2>';
        h += _rptSection();

        // ── 2. 좌굴 해석 ──
        h += '<h2>'+(++sec)+'. 탄성 좌굴 해석</h2>';
        h += _rptBuckling();

        // ── 3. 설계 입력 ──
        h += '<h2>'+(++sec)+'. 설계 입력</h2>';
        h += _rptDesignInput(la, d);

        // ── 4. 하중 분석 ──
        if (la) {
            h += '<h2>'+(++sec)+'. 하중 분석 결과</h2>';
            h += _rptLoadAnalysis(la);
        }

        // ── 5. 설계 계산 ──
        if (d) {
            const mtLabel = {compression:'압축 (Chapter E)',flexure:'휨 (Chapter F)',combined:'조합 (Chapters E+F+H)',tension:'인장 (Chapter D)'}[d.member_type||''] || d.member_type;
            h += '<h2>'+(++sec)+'. 설계 계산 — '+mtLabel+'</h2>';
            h += _rptDesignCalc(d);
        }

        // ── 6. 설계 요약 ──
        if (d) {
            h += '<h2>'+(++sec)+'. 설계 요약</h2>';
            h += _rptSummary(d, la);
        }

        h += '<hr><p style="text-align:center;color:#999;font-size:9px">CUFSM 냉간성형강 단면 설계 프로그램 — AISI S100-16 DSM</p>';
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 1. Section — 그림 + 규격 + 속성
    // ═══════════════════════════════════════════════════════
    function _rptSection() {
        let h = '';
        if (!model || !model.node || model.node.length === 0) return '<p>(단면 미정의)</p>';

        // SVG
        let xMin=Infinity,xMax=-Infinity,zMin=Infinity,zMax=-Infinity;
        model.node.forEach(n => { xMin=Math.min(xMin,n[1]);xMax=Math.max(xMax,n[1]);zMin=Math.min(zMin,n[2]);zMax=Math.max(zMax,n[2]); });
        const pad = Math.max(xMax-xMin,zMax-zMin)*0.2||1;
        const vb = (xMin-pad)+' '+(zMin-pad)+' '+(xMax-xMin+2*pad)+' '+(zMax-zMin+2*pad);
        let svg = '<svg width="180" height="180" viewBox="'+vb+'" style="border:1px solid #ddd;border-radius:4px;background:#fafafa">';
        if (model.elem) model.elem.forEach(e => {
            const ni=e[1]-1,nj=e[2]-1;
            if (ni>=0&&ni<model.node.length&&nj>=0&&nj<model.node.length)
                svg += '<line x1="'+model.node[ni][1]+'" y1="'+model.node[ni][2]+'" x2="'+model.node[nj][1]+'" y2="'+model.node[nj][2]+'" stroke="#1565c0" stroke-width="0.12" stroke-linecap="round"/>';
        });
        model.node.forEach(n => { svg += '<circle cx="'+n[1]+'" cy="'+n[2]+'" r="0.06" fill="#ff9800"/>'; });
        svg += '</svg>';

        // 규격 표 (그림 옆에)
        const selT = document.getElementById('select-template');
        const secType = selT ? selT.value : '';
        const typeNames = {lippedc:'립 C형강',lippedz:'립 Z형강',hat:'모자 단면',track:'트랙 단면',rhs:'각형 강관',chs:'원형 강관',angle:'앵글',isect:'I형강',tee:'T형강'};
        const H0=getNum('tpl-H',0),B0=getNum('tpl-B',0),D0=getNum('tpl-D',0),t0=getNum('tpl-t',0),r0=getNum('tpl-r',0);

        h += '<div style="display:flex;gap:16px;align-items:flex-start">';
        h += '<div>'+svg+'</div>';
        h += '<div style="flex:1"><h3>단면 제원</h3>';
        h += '<table><tr><th>항목</th><th>값</th><th>단위</th></tr>';
        h += '<tr><td>단면 유형</td><td colspan="2"><b>'+(typeNames[secType]||secType||'사용자 정의')+'</b></td></tr>';
        if (H0) h += '<tr><td>H (높이)</td><td>'+H0+'</td><td>'+_rul('length')+'</td></tr>';
        if (B0) h += '<tr><td>B (플랜지 폭)</td><td>'+B0+'</td><td>'+_rul('length')+'</td></tr>';
        if (D0) h += '<tr><td>D (립 깊이)</td><td>'+D0+'</td><td>'+_rul('length')+'</td></tr>';
        if (t0) h += '<tr><td>t (두께)</td><td>'+t0+'</td><td>'+_rul('thickness')+'</td></tr>';
        if (r0) h += '<tr><td>r (코너 반경)</td><td>'+r0+'</td><td>'+_rul('radius')+'</td></tr>';
        h += '<tr><td>절점 / 요소</td><td colspan="2">'+model.node.length+' / '+(model.elem?model.elem.length:0)+'</td></tr>';
        h += '</table></div></div>';

        // 단면 성질
        if (lastProps) {
            const p = lastProps;
            h += '<h3>계산된 단면 성질</h3>';
            h += '<table><tr><th>성질</th><th>기호</th><th>값</th><th>단위</th></tr>';
            const rows = [
                ['총단면적','A',p.A,'area'],
                ['강축 단면2차모멘트','I<sub>xx</sub>',p.Ixx,'inertia'],['약축 단면2차모멘트','I<sub>zz</sub>',p.Izz,'inertia'],
                ['단면상승모멘트','I<sub>xz</sub>',p.Ixz,'inertia'],
                ['강축 단면계수','S<sub>x</sub>',p.Sx,'modulus'],['약축 단면계수','S<sub>z</sub>',p.Sz,'modulus'],
                ['강축 소성단면계수','Z<sub>x</sub>',p.Zx,'modulus'],['약축 소성단면계수','Z<sub>z</sub>',p.Zz,'modulus'],
                ['강축 회전반경','r<sub>x</sub>',p.rx,'length'],['약축 회전반경','r<sub>z</sub>',p.rz,'length'],
                ['도심 x','x<sub>cg</sub>',p.xcg,'length'],['도심 z','z<sub>cg</sub>',p.zcg,'length'],
                ['주축 각도','&theta;<sub>p</sub>',p.thetap,null],
                ['주축 단면2차모멘트 1','I<sub>11</sub>',p.I11,'inertia'],['주축 단면2차모멘트 2','I<sub>22</sub>',p.I22,'inertia'],
            ];
            rows.forEach(r => { if (r[2]!=null) h += '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td><td>'+(r[3]?_ruv(r[2],r[3]):_rv(r[2],1))+'</td><td>'+(r[3]?_rul(r[3]):'\u00B0')+'</td></tr>'; });
            h += '</table>';
        }
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 2. Elastic Buckling — Signature Curve + DSM Values
    // ═══════════════════════════════════════════════════════
    function _rptBuckling() {
        let h = '';
        // Signature curve
        if (analysisResult && analysisResult.curve && analysisResult.curve.length > 0) {
            h += '<h3>좌굴 곡선 (하중계수 vs. 반파장)</h3>';
            const curve = analysisResult.curve;
            const W=500,H2=220,PL=55,PR=15,PT=20,PB=35;
            const plotW=W-PL-PR,plotH=H2-PT-PB;
            // 포스트프로세서와 동일한 데이터 추출 — row[1]>0 필터링
            const points=[];
            curve.forEach(row => { if (row && row.length>=2 && row[1]>0) points.push([row[0],row[1]]); });
            if (points.length < 2) { h += '<p>(곡선 데이터 부족)</p>'; }
            else {
            const xMin=Math.log10(Math.min(...points.map(p=>p[0])));
            const xMax=Math.log10(Math.max(...points.map(p=>p[0])));
            // 포스트프로세서와 동일: Y축 0 ~ yMax*1.15, 선형 스케일
            const yMax=Math.max(...points.map(p=>p[1]))*1.15;
            const yMin=0;
            const toSvgX = (val) => PL+(Math.log10(Math.max(val,0.1))-xMin)/(xMax-xMin)*plotW;
            const toSvgY = (val) => PT+plotH-((val-yMin)/(yMax-yMin))*plotH;
            let pathD='';
            points.forEach((pt,i) => {
                pathD+=(i===0?'M':'L')+toSvgX(pt[0]).toFixed(1)+','+toSvgY(pt[1]).toFixed(1);
            });
            let svg='<svg width="'+W+'" height="'+H2+'" style="border:1px solid #ddd;border-radius:4px;background:#fafafa">';
            svg+='<rect x="'+PL+'" y="'+PT+'" width="'+plotW+'" height="'+plotH+'" fill="none" stroke="#ccc"/>';
            // 그리드 (log X축)
            for (let exp=Math.ceil(xMin);exp<=Math.floor(xMax);exp++){
                const gx=toSvgX(Math.pow(10,exp));
                svg+='<line x1="'+gx.toFixed(1)+'" y1="'+PT+'" x2="'+gx.toFixed(1)+'" y2="'+(PT+plotH)+'" stroke="#eee" stroke-width="0.5"/>';
                svg+='<text x="'+gx.toFixed(1)+'" y="'+(H2-PB+14)+'" font-size="8" text-anchor="middle" fill="#999">'+Math.pow(10,exp)+'</text>';
            }
            // Y축 그리드
            const yStep=Math.pow(10,Math.floor(Math.log10(yMax/4)));
            for (let yv=yStep;yv<yMax;yv+=yStep){
                const gy=toSvgY(yv);
                svg+='<line x1="'+PL+'" y1="'+gy.toFixed(1)+'" x2="'+(PL+plotW)+'" y2="'+gy.toFixed(1)+'" stroke="#eee" stroke-width="0.5"/>';
                svg+='<text x="'+(PL-4)+'" y="'+(gy+3).toFixed(1)+'" font-size="8" text-anchor="end" fill="#999">'+yv.toFixed(yv<1?3:(yv<10?2:1))+'</text>';
            }
            // 곡선
            svg+='<path d="'+pathD+'" fill="none" stroke="#1565c0" stroke-width="1.5"/>';
            // 최소값 인덱스
            let minLF=points[0][1],mi=0;
            points.forEach((pt,i)=>{if(pt[1]<minLF){minLF=pt[1];mi=i;}});
            const dsmD = lastDsmResult ? (lastDsmResult.Mxx || lastDsmResult.P) : null;
            const extrema = [];
            if (dsmD) {
                if (dsmD.LF_local > 0 && dsmD.Lcrl > 0) extrema.push({L:dsmD.Lcrl,LF:dsmD.LF_local,label:dsmD.Mxxcrl!==undefined?'Mcrl':'Pcrl',color:'#ff5722'});
                if (dsmD.LF_dist > 0 && dsmD.Lcrd > 0) extrema.push({L:dsmD.Lcrd,LF:dsmD.LF_dist,label:dsmD.Mxxcrd!==undefined?'Mcrd':'Pcrd',color:'#ffab00'});
                if (dsmD.LF_global > 0 && dsmD.Lcre > 0) extrema.push({L:dsmD.Lcre,LF:dsmD.LF_global,label:dsmD.Mxxcre!==undefined?'Mcre':'Pcre',color:'#7c4dff'});
            }
            if (extrema.length === 0) {
                extrema.push({L:points[mi][0],LF:minLF,label:'min',color:'#e53935'});
            }
            extrema.forEach(ext => {
                const ex=toSvgX(ext.L).toFixed(1), ey=toSvgY(ext.LF).toFixed(1);
                svg+='<circle cx="'+ex+'" cy="'+ey+'" r="4" fill="'+ext.color+'" stroke="#fff" stroke-width="1"/>';
                svg+='<text x="'+(parseFloat(ex)+6)+'" y="'+(parseFloat(ey)-6)+'" font-size="8" fill="'+ext.color+'" font-weight="600">'+ext.label+'='+ext.LF.toFixed(3)+' @ L='+_ruv(ext.L,'length')+'</text>';
            });
            svg+='<text x="'+(PL+plotW/2)+'" y="'+(H2-3)+'" font-size="9" text-anchor="middle" fill="#666">반파장 ('+_rul('length')+')</text>';
            svg+='<text x="12" y="'+(PT+plotH/2)+'" font-size="9" text-anchor="middle" fill="#666" transform="rotate(-90,12,'+(PT+plotH/2)+')">하중계수</text>';
            svg+='</svg>';
            h += '<div class="section-fig">'+svg+'</div>';
            } // end if (points.length >= 2)
        } else {
            h += '<p>(좌굴 곡선을 생성하려면 FSM 해석을 먼저 실행하세요)</p>';
        }

        // DSM 설계값
        h += '<h3>DSM 설계값 (좌굴 곡선에서 추출)</h3>';
        if (lastDsmResult) {
            const dP=lastDsmResult.P||{},dM=lastDsmResult.Mxx||{};
            h += '<table><tr><th>성질</th><th>값</th><th>반파장</th><th>하중계수</th></tr>';
            const _fU=_rul('force'),_mU=_rul('moment'),_lU=_rul('length');
            h += '<tr><td colspan="4" style="font-weight:600;background:#f0f0f0">압축 ('+_fU+')</td></tr>';
            h += '<tr><td>P<sub>y</sub> (항복)</td><td>'+_ruv(dP.Py,'force')+' '+_fU+'</td><td></td><td></td></tr>';
            h += '<tr><td>P<sub>crl</sub> (국부)</td><td>'+_ruv(dP.Pcrl,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcrl,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_local,4)+'</td></tr>';
            h += '<tr><td>P<sub>crd</sub> (뒤틀림)</td><td>'+_ruv(dP.Pcrd,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcrd,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_dist,4)+'</td></tr>';
            h += '<tr><td>P<sub>cre</sub> (전체)</td><td>'+_ruv(dP.Pcre,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcre,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_global,4)+'</td></tr>';
            h += '<tr><td colspan="4" style="font-weight:600;background:#f0f0f0">휨 ('+_mU+')</td></tr>';
            h += '<tr><td>M<sub>y</sub> (항복)</td><td>'+_ruv(dM.My_xx,'moment')+' '+_mU+'</td><td></td><td></td></tr>';
            h += '<tr><td>M<sub>crl</sub> (국부)</td><td>'+_ruv(dM.Mxxcrl,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcrl,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_local,4)+'</td></tr>';
            h += '<tr><td>M<sub>crd</sub> (뒤틀림)</td><td>'+_ruv(dM.Mxxcrd,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcrd,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_dist,4)+'</td></tr>';
            h += '<tr><td>M<sub>cre</sub> (전체)</td><td>'+_ruv(dM.Mxxcre,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcre,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_global,4)+'</td></tr>';
            h += '</table>';
            const dsm0 = dP.n_minima !== undefined ? dP : dM;
            if (dsm0.n_minima !== undefined) {
                h += '<p style="font-size:10px;color:#666">'+dsm0.n_minima+'개 최솟값 검출.';
                if (dsm0.minima) dsm0.minima.forEach((m,i) => { h += ' 최솟값 '+(i+1)+': L='+_ruv(m.length,'length')+' '+_lU+', LF='+m.load_factor.toFixed(4)+'.'; });
                h += '</p>';
            }
        } else {
            h += '<p>(DSM 결과 없음 — FSM 해석을 먼저 실행하세요)</p>';
        }
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 3. Design Input — 하중, 재료, 부재 구성
    // ═══════════════════════════════════════════════════════
    function _rptDesignInput(la, d) {
        let h = '';

        // 재료 (입력 필드값은 이미 표시 단위 → 직접 사용, US 상수는 _ruv로 변환)
        const fy = getNum('design-fy',52.94), fu = getNum('design-fu',71.08);
        const gradeEl = document.getElementById('select-steel-grade');
        const gradeName = gradeEl ? gradeEl.options[gradeEl.selectedIndex].text : 'Custom';
        h += '<h3>재료</h3>';
        h += '<table><tr><th>항목</th><th>값</th><th>단위</th></tr>';
        h += '<tr><td>강종</td><td colspan="2">'+gradeName+'</td></tr>';
        h += '<tr><td>항복강도, F<sub>y</sub></td><td>'+fy+'</td><td>'+_rul('stress')+'</td></tr>';
        h += '<tr><td>인장강도, F<sub>u</sub></td><td>'+fu+'</td><td>'+_rul('stress')+'</td></tr>';
        h += '<tr><td>탄성계수, E</td><td>'+_ruv(29435,'stress')+'</td><td>'+_rul('stress')+'</td></tr>';
        h += '<tr><td>포아송비, &nu;</td><td>0.30</td><td></td></tr>';
        h += '</table>';

        // 부재 구성
        const memberApp = document.getElementById('select-member-type');
        const memberName = memberApp ? memberApp.options[memberApp.selectedIndex].text : '';
        const spanEl = document.getElementById('select-span-type');
        const spanName = spanEl ? spanEl.options[spanEl.selectedIndex].text : '';
        const _spanTblEls = document.querySelectorAll('.span-tbl-len');
        const spanFt = _spanTblEls.length > 0 ? (parseFloat(/** @type {HTMLInputElement} */ (_spanTblEls[0]).value) || 0) : 0;
        const spacing = getNum('config-spacing',5);
        const dm = document.getElementById('select-design-method');
        const dmName = dm ? dm.value : 'LRFD';

        h += '<h3>부재 구성</h3>';
        h += '<table><tr><th>항목</th><th>값</th></tr>';
        if (memberName) h += '<tr><td>부재 적용</td><td>'+memberName+'</td></tr>';
        if (spanName) h += '<tr><td>스팬 유형</td><td>'+spanName+(la?' ('+la.n_spans+'경간)':'')+'</td></tr>';
        if (spanFt) h += '<tr><td>스팬 길이</td><td>'+spanFt+' '+_rul('length_ft')+'</td></tr>';
        h += '<tr><td>분담폭 (간격)</td><td>'+spacing+' '+_rul('length_ft')+'</td></tr>';
        h += '<tr><td>설계 방법</td><td>'+dmName+'</td></tr>';
        const lapL = getNum('config-lap-left',0), lapR = getNum('config-lap-right',0);
        if (lapL || lapR) h += '<tr><td>랩 길이 (좌 / 우)</td><td>'+lapL+' / '+lapR+' '+_rul('length_ft')+'</td></tr>';
        h += '</table>';

        // 설계하중 (psf, spacing은 이미 표시 단위값)
        h += '<h3>설계 하중</h3>';
        h += '<table><tr><th>하중 유형</th><th>'+_rul('pressure')+'</th><th>'+_rul('linload')+' (&times;'+spacing+' '+_rul('length_ft')+')</th><th>설명</th></tr>';
        const loadDefs = [
            ['D','load-D-psf','고정하중 (자중 + 부가하중)'],
            ['Lr','load-Lr-psf','지붕 활하중'],
            ['S','load-S-psf','적설하중'],
            ['L','load-L-psf','바닥 활하중'],
            ['W (양력)','load-Wu-psf','풍양력 하중'],
        ];
        loadDefs.forEach(ld => {
            const psf = getNum(ld[1],0);
            const psfUS = fromDisplay(psf, 'pressure');
            const spacingUS = fromDisplay(spacing, 'length_ft');
            const plfUS = psfUS * spacingUS;
            if (psf > 0) h += '<tr><td>'+ld[0]+'</td><td>'+psf+' '+_rul('pressure')+'</td><td>'+_ruv(plfUS,'linload')+' '+_rul('linload')+'</td><td>'+ld[2]+'</td></tr>';
        });
        h += '</table>';

        // 데크 정보 (입력 표시값 직접 사용)
        const deckType = document.getElementById('select-deck-type');
        const deckName = deckType ? deckType.options[deckType.selectedIndex].text : 'None';
        if (deckName !== 'None' && deckName !== 'none') {
            h += '<h3>데크 정보</h3>';
            h += '<table><tr><th>항목</th><th>값</th></tr>';
            h += '<tr><td>데크 유형</td><td>'+deckName+'</td></tr>';
            h += '<tr><td>패널 두께, t<sub>panel</sub></td><td>'+getNum('deck-t-panel',0.018)+' '+_rul('thickness')+'</td></tr>';
            h += '<tr><td>체결구 간격</td><td>'+getNum('deck-fastener-spacing',12)+' '+_rul('length')+'</td></tr>';
            h += '</table>';
        }
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 4. Load Analysis — 다이어그램 + 위치 + Auto Params
    // ═══════════════════════════════════════════════════════
    function _rptLoadAnalysis(la) {
        let h = '';
        if (la.gravity && la.gravity.M_diagram && la.gravity.M_diagram.length > 2) {
            h += renderBeamSchematic(la);
            const mVals = _unitSystem === 'SI' ? la.gravity.M_diagram.map(v => toDisplay(v,'moment_ft')) : la.gravity.M_diagram;
            h += renderDiagramSVG(mVals, '모멘트 다이어그램 ('+_rul('moment_ft')+')', '#1565c0', true);
        }
        if (la.gravity && la.gravity.V_diagram && la.gravity.V_diagram.length > 2) {
            const vVals = _unitSystem === 'SI' ? la.gravity.V_diagram.map(v => toDisplay(v,'force')) : la.gravity.V_diagram;
            h += renderDiagramSVG(vVals, '전단력 다이어그램 ('+_rul('force')+')', '#e65100', false);
        }

        if (la.gravity) {
            h += '<h3>중력 지배 하중조합: '+la.gravity.combo+'</h3>';
            h += '<table><tr><th>위치</th><th>x ('+_rul('length_ft')+')</th><th>M<sub>u</sub> ('+_rul('moment_ft')+')</th><th>V<sub>u</sub> ('+_rul('force')+')</th><th>R<sub>u</sub> ('+_rul('force')+')</th><th>구간</th></tr>';
            la.gravity.locations.forEach(loc => {
                h += '<tr><td>'+loc.name+'</td><td>'+_ruv(loc.x_ft,'length_ft')+'</td><td>'+_ruv(loc.Mu,'moment_ft')+'</td><td>'+_ruv(loc.Vu,'force')+'</td><td>'+_ruv(loc.Ru,'force')+'</td><td>'+( loc.region||'')+'</td></tr>';
            });
            h += '</table>';
        }
        if (la.uplift) {
            h += '<h3>양력 지배 하중조합: '+la.uplift.combo+'</h3>';
            h += '<table><tr><th>위치</th><th>M<sub>u</sub> ('+_rul('moment_ft')+')</th></tr>';
            la.uplift.locations.forEach(loc => { h += '<tr><td>'+loc.name+'</td><td>'+_ruv(loc.Mu,'moment_ft')+'</td></tr>'; });
            h += '</table>';
        }

        // 하중조합 상세 결과 (보고서용)
        if (la.all_combos_detail && la.all_combos_detail.length > 0) {
            const plf = la.input_loads_plf || {};
            const _loadLabels = {D:'고정(D)',Lr:'지붕활(Lr)',S:'적설(S)',L:'활(L)',W:'풍(W)',E:'지진(E)',R:'우수(R)'};
            h += '<h3>하중조합 상세 ('+la.design_method+', ASCE 7)</h3>';
            // 입력하중 표
            h += '<table><tr><th>하중</th><th>'+_rul('linload')+'</th></tr>';
            for (const [k, v] of Object.entries(plf)) {
                h += '<tr><td>'+(_loadLabels[k]||k)+'</td><td><b>'+_ruv(Math.abs(v),'linload')+'</b></td></tr>';
            }
            h += '</table>';
            // 조합 결과 표
            h += '<table><tr><th>조합</th><th>조합 수식</th><th>|M|<sub>max</sub> ('+_rul('moment_ft')+')</th><th>|V|<sub>max</sub> ('+_rul('force')+')</th><th>지배</th></tr>';
            la.all_combos_detail.forEach(cd => {
                const isGov = cd.governs_gravity || cd.governs_uplift;
                const bld = isGov ? 'font-weight:700;background:#f0f7f0' : '';
                const terms = [];
                for (const [lt, factor] of Object.entries(cd.factors)) {
                    const w = plf[lt];
                    if (w == null) continue;
                    const fStr = factor === 1.0 ? '' : factor+'&times;';
                    terms.push('<b>'+fStr+'</b>'+(_loadLabels[lt]||lt)+'('+_ruv(Math.abs(w),'linload')+')');
                }
                let govTag = '';
                if (cd.governs_gravity) govTag += '<b style="color:#4caf50">중력 지배</b>';
                if (cd.governs_uplift) govTag += '<b style="color:#ff9800">양력 지배</b>';
                h += '<tr style="'+bld+'"><td>'+cd.name+'</td><td>'+terms.join(' + ')+'</td><td><b>'+_ruv(cd.max_abs_M,'moment_ft')+'</b></td><td>'+_ruv(cd.max_abs_V,'force')+'</td><td>'+govTag+'</td></tr>';
            });
            h += '</table>';
        }

        // Auto-Determined Parameters with explanation
        if (la.auto_params) {
            const ap = la.auto_params;
            h += '<h3>자동 결정 설계 매개변수</h3>';
            h += '<p style="font-size:10px;color:#555">다음 매개변수는 하중 분석 결과, 데크 구성 및 모멘트 다이어그램 형태에서 자동 계산됩니다:</p>';
            h += '<table><tr><th>매개변수</th><th>값</th><th>계산 방법</th></tr>';
            if (ap.deck && ap.deck.type !== 'none') {
                h += '<tr><td>k<sub>&phi;</sub> (회전강성)</td><td>'+_ruv(ap.deck.kphi,'rotStiff')+' '+_rul('rotStiff')+'</td>';
                h += '<td>Chen & Moen (2011): k<sub>&phi;</sub> = 1/(1/(k&middot;c&sup2;) + c&sup3;/(3EIc&sup2;)), k=체결구강성/간격, c=플랜지/2</td></tr>';
                h += '<tr><td>k<sub>x</sub> (횡강성)</td><td>'+ap.deck.kx+' kip/in/in</td>';
                h += '<td>2겹 직렬 스프링: k<sub>x</sub> = (1/(1/(Et<sub>1</sub>)+1/(Et<sub>2</sub>)))/s &times; 0.04 감소계수</td></tr>';
            }
            if (ap.positive_region) {
                h += '<tr><td>정모멘트 구간 가새</td><td>완전 지지 (L<sub>y</sub>=0)</td>';
                h += '<td>상부 플랜지 압축, 데크 패널로 연속 지지 — LTB 검토 불필요</td></tr>';
            }
            if (ap.negative_region) {
                h += '<tr><td>부모멘트 L<sub>y</sub></td><td>'+_ruv(ap.negative_region.Ly_in,'length')+' '+_rul('length')+'</td>';
                h += '<td>변곡점(M=0)에서 랩 끝단 또는 지점까지 거리. 하부 플랜지 압축 — 비지지.</td></tr>';
                h += '<tr><td>부모멘트 C<sub>b</sub></td><td>'+ap.negative_region.Cb+'</td>';
                h += '<td>AISI Eq. F2.1.1-2: C<sub>b</sub> = 12.5M<sub>max</sub> / (2.5M<sub>max</sub>+3M<sub>A</sub>+4M<sub>B</sub>+3M<sub>C</sub>), 비지지 구간 모멘트 다이어그램에서 계산</td></tr>';
            }
            if (ap.uplift_R != null) {
                h += '<tr><td>양력 R (§I6.2.1)</td><td>'+ap.uplift_R+'</td>';
                h += '<td>AISI S100 §I6.2.1 감소계수 — 단면 형상 검토 기반 (d/t, d/b, b&ge;2.125, flat_b/t 등)</td></tr>';
            }
            if (ap.unbraced && ap.unbraced.inflection_points_ft) {
                h += '<tr><td>변곡점</td><td>'+ap.unbraced.inflection_points_ft.map(v=>_ruv(v,'length_ft')).join(', ')+' '+_rul('length_ft')+'</td>';
                h += '<td>모멘트 = 0인 위치, 모멘트 다이어그램의 선형보간으로 산출</td></tr>';
            }
            h += '</table>';
        }

        // 처짐 결과
        if (la.deflection && la.deflection.D_diagram && la.deflection.D_diagram.length > 2) {
            h += '<h3>처짐 검토 (사용하중: '+la.deflection.combo+')</h3>';
            const dVals = _unitSystem === 'SI'
                ? la.deflection.D_diagram.map(v => toDisplay(v, 'length'))
                : la.deflection.D_diagram;
            h += renderDiagramSVG(dVals, '처짐 다이어그램 ('+_rul('length')+')', '#66bb6a', false);

            if (la.deflection.per_span) {
                h += '<table><tr><th>스팬</th><th>위치</th><th>최대 처짐</th><th>L/δ</th></tr>';
                la.deflection.per_span.forEach(ps => {
                    h += '<tr><td>'+ps.span+'</td>';
                    h += '<td>'+_ruv(ps.x_ft,'length_ft')+' '+_rul('length_ft')+'</td>';
                    h += '<td>'+_ruv(ps.abs_delta_in,'length')+' '+_rul('length')+'</td>';
                    h += '<td>L/'+(ps.L_over_delta === Infinity ? '∞' : ps.L_over_delta.toFixed(0))+'</td></tr>';
                });
                h += '</table>';
                h += '<p style="font-size:10px;color:#555">E='+_ruv(la.deflection.E_ksi,'stress')+' '+_rul('stress')+', Ixx='+_ruv(la.deflection.Ixx,'inertia')+' '+_rul('inertia')+'</p>';
            }
        }

        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 5. Design Calculation — 상세 수식 + 조건문
    // ═══════════════════════════════════════════════════════
    function _rptDesignCalc(d) {
        const mt = d.member_type || '';
        const dm = d.design_method || 'LRFD';
        let h = '';
        if (mt === 'flexure') h += _rptFlexure(d, dm);
        else if (mt === 'compression') h += _rptCompression(d, dm);
        else if (mt === 'combined') h += _rptCombined(d, dm);
        else if (mt === 'tension') h += _rptTension(d, dm);

        // Interaction check
        if (d.interaction) {
            const ir = d.interaction;
            h += '<h3>조합 검토 — §H1.2 (Eq. '+( ir.equation||'H1.2-1')+')</h3>';
            h += '<span class="eq">P<sub>u</sub>/P<sub>a</sub> + M<sub>ux</sub>/M<sub>ax</sub> + M<sub>uy</sub>/M<sub>ay</sub> &le; 1.0</span>';
            h += '<table><tr><th>항</th><th>소요</th><th>저항</th><th>비율</th></tr>';
            h += '<tr><td>축력 P/Pa</td><td></td><td></td><td>'+_rv(ir.P_ratio,4)+'</td></tr>';
            h += '<tr><td>휨 Mx/Max</td><td></td><td></td><td>'+_rv(ir.Mx_ratio,4)+'</td></tr>';
            h += '<tr><td>휨 My/May</td><td></td><td></td><td>'+_rv(ir.My_ratio,4)+'</td></tr>';
            h += '<tr style="font-weight:700"><td>합계</td><td colspan="2"></td><td class="'+(ir.pass?'pass':'fail')+'">'+_rv(ir.total,4)+' &le; 1.0 '+(ir.pass?'OK':'NG')+'</td></tr>';
            h += '</table>';
        }
        if (d.shear_interaction) {
            const si = d.shear_interaction;
            h += '<h3>휨 + 전단 조합 검토 — §H2 (Eq. '+(si.equation||'H2-1')+')</h3>';
            h += '<span class="eq">(M<sub>u</sub>/M<sub>ao</sub>)&sup2; + (V<sub>u</sub>/V<sub>a</sub>)&sup2; &le; 1.0</span>';
            h += '<table><tr><th>항</th><th>비율</th></tr>';
            h += '<tr><td>M/Mao</td><td>'+_rv(si.M_ratio,4)+'</td></tr>';
            h += '<tr><td>V/Va</td><td>'+_rv(si.V_ratio,4)+'</td></tr>';
            h += '<tr style="font-weight:700"><td>합계 (SRSS)</td><td class="'+(si.pass?'pass':'fail')+'">'+_rv(si.total,4)+' &le; 1.0 '+(si.pass?'OK':'NG')+'</td></tr>';
            h += '</table>';
        }

        // Step summary table
        const steps = d.steps || [];
        if (steps.length > 0) {
            h += '<h3>계산 단계 요약</h3>';
            h += '<table><tr><th>#</th><th>단계</th><th>수식</th><th>결과</th><th>단위</th></tr>';
            steps.forEach(s => {
                const gov = s.controlling_mode ? ' style="background:#fff3e0;font-weight:600"' : '';
                h += '<tr'+gov+'><td>'+s.step+'</td><td>'+s.name+(s.controlling_mode?' <b>[지배]</b>':'')+'</td>';
                h += '<td style="font-size:10px">'+(s.formula||'')+'</td>';
                const sut = _mapUSUnit(s.unit);
                const sv = (s.value != null && sut) ? _ruv(s.value, sut) : (s.value != null ? s.value : '');
                const su = sut ? _rul(sut) : (s.unit || '');
                h += '<td style="text-align:right;font-weight:600">'+sv+'</td><td>'+su+'</td></tr>';
            });
            h += '</table>';
        }
        return h;
    }

    function _rptFlexure(d, dm) {
        let h = '';
        const phi=0.90,omega=1.67;
        // Step 1: My
        h += '<h3>단계 1: 항복 모멘트, M<sub>y</sub></h3>';
        h += '<span class="eq">M<sub>y</sub> = S<sub>f</sub> &times; F<sub>y</sub> = '+_ruv(d.My,'moment')+' '+_rul('moment')+'</span>';

        // Step 2: Global/LTB — Mne
        h += '<h3>단계 2: 전체좌굴 / 횡-비틀림좌굴 — §F2</h3>';
        h += '<p>전체좌굴 응력 F<sub>cre</sub>는 비지지 길이 L<sub>b</sub>, 모멘트 구배 C<sub>b</sub>, 단면 성질(r<sub>y</sub>, J, C<sub>w</sub>)로 산정합니다.</p>';
        h += '<span class="eq">F<sub>cre</sub> = C<sub>b</sub> &middot; r<sub>o</sub> &middot; A / S<sub>f</sub> &middot; &radic;(&sigma;<sub>ey</sub> &middot; &sigma;<sub>t</sub>)</span>';
        h += '<p>F<sub>cre</sub>와 F<sub>y</sub>의 관계에 따라:</p>';
        h += '<table><tr><th>조건</th><th>수식</th><th>영역</th></tr>';
        h += '<tr><td>F<sub>cre</sub> &ge; 2.78 F<sub>y</sub></td><td>F<sub>n</sub> = F<sub>y</sub></td><td>항복 (조밀)</td></tr>';
        h += '<tr><td>2.78 F<sub>y</sub> &gt; F<sub>cre</sub> &gt; 0.56 F<sub>y</sub></td><td>F<sub>n</sub> = (10/9)F<sub>y</sub>(1 - 10F<sub>y</sub>/(36F<sub>cre</sub>))</td><td>비탄성 LTB</td></tr>';
        h += '<tr><td>F<sub>cre</sub> &le; 0.56 F<sub>y</sub></td><td>F<sub>n</sub> = F<sub>cre</sub></td><td>탄성 LTB</td></tr>';
        h += '</table>';
        h += '<span class="eq">M<sub>ne</sub> = S<sub>f</sub> &times; F<sub>n</sub> = <b>'+_ruv(d.Mne,'moment')+'</b> '+_rul('moment')+'</span>';

        // Step 3: Local — Mnl
        h += '<h3>단계 3: 국부좌굴 — §F3.2</h3>';
        h += '<p>국부 세장비 &lambda;<sub>l</sub>이 0.776을 초과하면 국부좌굴이 전체강도 M<sub>ne</sub>를 감소시킵니다:</p>';
        h += '<span class="eq">&lambda;<sub>l</sub> = &radic;(M<sub>ne</sub> / M<sub>crl</sub>)</span>';
        h += '<table><tr><th>조건</th><th>수식</th></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &le; 0.776</td><td>M<sub>nl</sub> = M<sub>ne</sub> (감소 없음)</td></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &gt; 0.776</td><td>M<sub>nl</sub> = [1 - 0.15(M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup>] &middot; (M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup> &middot; M<sub>ne</sub></td></tr>';
        h += '</table>';
        const govL = d.Mnl < d.Mne ? ' (국부좌굴로 강도 '+(100*(1-d.Mnl/d.Mne)).toFixed(1)+'% 감소)' : ' (감소 없음)';
        h += '<span class="eq">M<sub>nl</sub> = <b>'+_ruv(d.Mnl,'moment')+'</b> '+_rul('moment')+govL+'</span>';

        // Step 4: Distortional — Mnd
        h += '<h3>단계 4: 뒤틀림좌굴 — §F4</h3>';
        h += '<p>뒤틀림좌굴은 M<sub>y</sub>에 대해 독립적으로 검토합니다:</p>';
        h += '<span class="eq">&lambda;<sub>d</sub> = &radic;(M<sub>y</sub> / M<sub>crd</sub>)</span>';
        h += '<table><tr><th>조건</th><th>수식</th></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &le; 0.673</td><td>M<sub>nd</sub> = M<sub>y</sub> (감소 없음)</td></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &gt; 0.673</td><td>M<sub>nd</sub> = [1 - 0.22(M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup>] &middot; (M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup> &middot; M<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">M<sub>nd</sub> = <b>'+_ruv(d.Mnd,'moment')+'</b> '+_rul('moment')+'</span>';

        // Step 5: Nominal & Design
        h += '<h3>단계 5: 공칭강도 & 설계강도</h3>';
        h += '<span class="eq">M<sub>n</sub> = min(M<sub>ne</sub>, M<sub>nl</sub>, M<sub>nd</sub>) = min('+_ruv(d.Mne,'moment')+', '+_ruv(d.Mnl,'moment')+', '+_ruv(d.Mnd,'moment')+') = <b>'+_ruv(d.Mn,'moment')+'</b> '+_rul('moment')+'</span>';
        h += '<span class="eq">지배 파괴 모드: <b>'+(d.controlling_mode||'')+'</b></span>';
        if (dm==='LRFD') {
            h += '<span class="eq">&phi;<sub>b</sub> = '+phi+' (LRFD)</span>';
            h += '<span class="eq">&phi;M<sub>n</sub> = '+phi+' &times; '+_ruv(d.Mn,'moment')+' = <b class="result">'+_ruv(d.phi_Mn,'moment')+'</b> '+_rul('moment')+'</span>';
        } else {
            h += '<span class="eq">&Omega;<sub>b</sub> = '+omega+' (ASD)</span>';
            h += '<span class="eq">M<sub>n</sub>/&Omega; = '+_ruv(d.Mn,'moment')+' / '+omega+' = <b class="result">'+_ruv(d.Mn_omega,'moment')+'</b> '+_rul('moment')+'</span>';
        }
        if (d.utilization != null) {
            const Mu = d.design_strength > 0 ? (d.utilization * d.design_strength) : 0;
            h += '<span class="eq">M<sub>u</sub> / '+(dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;')+' = '+_ruv(Mu,'moment')+' / '+_ruv(d.design_strength,'moment')+' = <b class="'+(d.pass?'pass':'fail')+'">'+_rv(d.utilization*100,1)+'%</b></span>';
        }
        return h;
    }

    function _rptCompression(d, dm) {
        let h = '';
        const phi=0.85,omega=1.80;
        h += '<h3>단계 1: 항복 하중, P<sub>y</sub></h3>';
        h += '<span class="eq">P<sub>y</sub> = A<sub>g</sub> &times; F<sub>y</sub> = '+_ruv(d.Py,'force')+' '+_rul('force')+'</span>';

        h += '<h3>단계 2: 전체좌굴 — §E2</h3>';
        h += '<p>휨, 비틀림 또는 휨-비틀림 좌굴응력 F<sub>cre</sub>는 KL/r, J, C<sub>w</sub> 및 단면 대칭성에서 결정됩니다.</p>';
        h += '<span class="eq">&lambda;<sub>c</sub> = &radic;(F<sub>y</sub> / F<sub>cre</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>c</sub> &le; 1.5</td><td>F<sub>n</sub> = (0.658<sup>&lambda;<sub>c</sub>&sup2;</sup>) F<sub>y</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>c</sub> &gt; 1.5</td><td>F<sub>n</sub> = (0.877/&lambda;<sub>c</sub>&sup2;) F<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>ne</sub> = A<sub>g</sub> &times; F<sub>n</sub> = <b>'+_ruv(d.Pne,'force')+'</b> '+_rul('force')+'</span>';

        h += '<h3>단계 3: 국부좌굴 — §E3.2</h3>';
        h += '<span class="eq">&lambda;<sub>l</sub> = &radic;(P<sub>ne</sub>/P<sub>crl</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &le; 0.776</td><td>P<sub>nl</sub> = P<sub>ne</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &gt; 0.776</td><td>P<sub>nl</sub> = [1-0.15(P<sub>crl</sub>/P<sub>ne</sub>)<sup>0.4</sup>](P<sub>crl</sub>/P<sub>ne</sub>)<sup>0.4</sup> P<sub>ne</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>nl</sub> = <b>'+_ruv(d.Pnl,'force')+'</b> '+_rul('force')+'</span>';

        h += '<h3>단계 4: 뒤틀림좌굴 — §E4</h3>';
        h += '<span class="eq">&lambda;<sub>d</sub> = &radic;(P<sub>y</sub>/P<sub>crd</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &le; 0.561</td><td>P<sub>nd</sub> = P<sub>y</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &gt; 0.561</td><td>P<sub>nd</sub> = [1-0.25(P<sub>crd</sub>/P<sub>y</sub>)<sup>0.6</sup>](P<sub>crd</sub>/P<sub>y</sub>)<sup>0.6</sup> P<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>nd</sub> = <b>'+_ruv(d.Pnd,'force')+'</b> '+_rul('force')+'</span>';

        h += '<h3>단계 5: 공칭강도 & 설계강도</h3>';
        h += '<span class="eq">P<sub>n</sub> = min(P<sub>ne</sub>,P<sub>nl</sub>,P<sub>nd</sub>) = min('+_ruv(d.Pne,'force')+','+_ruv(d.Pnl,'force')+','+_ruv(d.Pnd,'force')+') = <b>'+_ruv(d.Pn,'force')+'</b> '+_rul('force')+'</span>';
        h += '<span class="eq">지배 모드: <b>'+(d.controlling_mode||'')+'</b></span>';
        if (dm==='LRFD') h += '<span class="eq">&phi;P<sub>n</sub> = '+phi+' &times; '+_ruv(d.Pn,'force')+' = <b class="result">'+_ruv(d.phi_Pn,'force')+'</b> '+_rul('force')+'</span>';
        else h += '<span class="eq">P<sub>n</sub>/&Omega; = '+_ruv(d.Pn,'force')+'/'+omega+' = <b class="result">'+_ruv(d.Pn_omega,'force')+'</b> '+_rul('force')+'</span>';
        return h;
    }

    function _rptCombined(d, dm) {
        let h = '';
        const c=d.compression||{},f=d.flexure_x||{};
        h += '<h3>압축 강도</h3>';
        h += '<span class="eq">P<sub>n</sub> = '+_ruv(c.Pn,'force')+' '+_rul('force')+' ('+(c.controlling_mode||'')+'), 설계강도 = <b>'+_ruv(c.design_strength,'force')+'</b> '+_rul('force')+'</span>';
        h += '<h3>휨 강도 (x축)</h3>';
        h += '<span class="eq">M<sub>n</sub> = '+_ruv(f.Mn,'moment')+' '+_rul('moment')+' ('+(f.controlling_mode||'')+'), 설계강도 = <b>'+_ruv(f.design_strength,'moment')+'</b> '+_rul('moment')+'</span>';
        if (d.amplification) {
            const amp = d.amplification;
            h += '<h3>§C1 모멘트 확대 (P-&delta; 효과)</h3>';
            h += '<p>2차 P-&delta; 효과가 압축부재의 모멘트를 확대합니다:</p>';
            h += '<span class="eq">P<sub>Ex</sub> = &pi;&sup2;EA<sub>g</sub>/(KL/r<sub>x</sub>)&sup2; = '+_ruv(amp.PEx,'force')+' '+_rul('force')+'</span>';
            h += '<span class="eq">&alpha;<sub>x</sub> = C<sub>mx</sub> / (1 - P<sub>u</sub>/P<sub>Ex</sub>) = '+_rv(amp.alpha_x,4)+' &ge; 1.0</span>';
            h += '<span class="eq">M<sub>ux,amp</sub> = M<sub>ux</sub> &times; &alpha;<sub>x</sub> = '+_ruv(amp.Mux_amp,'moment')+' '+_rul('moment')+'</span>';
        }
        return h;
    }

    function _rptTension(d, dm) {
        let h = '';
        h += '<h3>§D2 — 총단면 인장항복</h3>';
        h += '<span class="eq">T<sub>n</sub> = A<sub>g</sub> &times; F<sub>y</sub> = '+_ruv(d.Tn_yield,'force')+' '+_rul('force')+', &phi;<sub>t</sub>=0.90, &Omega;<sub>t</sub>=1.67</span>';
        h += '<h3>§D3 — 순단면 인장파단</h3>';
        h += '<span class="eq">T<sub>n</sub> = A<sub>n</sub> &times; F<sub>u</sub> = '+_ruv(d.Tn_rupture,'force')+' '+_rul('force')+', &phi;<sub>t</sub>=0.75, &Omega;<sub>t</sub>=2.00</span>';
        h += '<span class="eq">지배 모드: <b>'+(d.controlling_mode||'')+'</b>, 설계강도 = <b class="result">'+_ruv(d.design_strength,'force')+'</b> '+_rul('force')+'</span>';
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 6. Design Summary
    // ═══════════════════════════════════════════════════════
    function _rptSummary(d, la) {
        const mt = d.member_type||'', dm = d.design_method||'LRFD';
        const mtNames = {flexure:'휨 부재 (보/퍼린)',compression:'압축 부재 (기둥/스터드)',combined:'축력+휨 조합 부재',tension:'인장 부재'};
        let h = '';

        h += '<p>본 보고서는 AISI S100-16 직접강도법(DSM)에 의한 <b>'+(mtNames[mt]||mt)+'</b>의 설계 검토 결과입니다. ';
        h += '설계 방법은 <b>'+dm+'</b>입니다. ';
        if (la) h += '부재는 <b>'+la.n_spans+'</b>경간이며, 중력 지배 하중조합은 <b>'+((la.gravity||{}).combo||'N/A')+'</b>입니다. ';
        h += '지배 파괴 모드는 <b>'+(d.controlling_mode||'N/A')+'</b>입니다.</p>';

        h += '<table>';
        h += '<tr><th style="width:50%">항목</th><th>값</th></tr>';
        h += '<tr><td>설계 기준</td><td>AISI S100-16</td></tr>';
        h += '<tr><td>해석 방법</td><td>직접강도법 (DSM) — 유한스트립법</td></tr>';
        h += '<tr><td>부재 유형</td><td>'+(mtNames[mt]||mt)+'</td></tr>';
        h += '<tr><td>설계 방법</td><td>'+dm+'</td></tr>';
        h += '<tr><td>지배 파괴 모드</td><td><b>'+(d.controlling_mode||'')+'</b></td></tr>';

        if (mt==='flexure') {
            h += '<tr><td>공칭 모멘트, M<sub>n</sub></td><td>'+_ruv(d.Mn,'moment')+' '+_rul('moment')+'</td></tr>';
            h += '<tr><td>설계강도, '+(dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;')+'</td><td><b>'+_ruv(d.design_strength,'moment')+'</b> '+_rul('moment')+'</td></tr>';
        } else if (mt==='compression') {
            h += '<tr><td>공칭강도, P<sub>n</sub></td><td>'+_ruv(d.Pn,'force')+' '+_rul('force')+'</td></tr>';
            h += '<tr><td>설계강도, '+(dm==='LRFD'?'&phi;P<sub>n</sub>':'P<sub>n</sub>/&Omega;')+'</td><td><b>'+_ruv(d.design_strength,'force')+'</b> '+_rul('force')+'</td></tr>';
        } else {
            h += '<tr><td>설계강도</td><td><b>'+_rv(d.design_strength)+'</b></td></tr>';
        }

        if (d.utilization != null) {
            const pct = (d.utilization*100).toFixed(1);
            h += '<tr><td>소요/저항 비율 (DCR)</td><td class="'+(d.pass?'pass':'fail')+'" style="font-size:14px"><b>'+pct+'% — '+(d.pass?'OK':'NG')+'</b></td></tr>';
        }
        if (d.interaction) {
            h += '<tr><td>조합 검토 (§H1.2)</td><td class="'+(d.interaction.pass?'pass':'fail')+'"><b>'+_rv(d.interaction.total,4)+'</b> &le; 1.0 — '+(d.interaction.pass?'OK':'NG')+'</td></tr>';
        }
        h += '<tr><td>참조 규준 조항</td><td>'+(d.spec_sections||[]).join(', ')+'</td></tr>';
        h += '</table>';

        // DSM 경고
        const warnings = d.dsm_warnings || [];
        if (warnings.length > 0) {
            h += '<div style="margin-top:8px;padding:6px;background:#fff3e0;border:1px solid #ff9800;border-radius:4px">';
            h += '<b style="color:#e65100">DSM 적용성 경고:</b><ul style="margin:4px 0;padding-left:20px">';
            warnings.forEach(w => { h += '<li>'+w+'</li>'; });
            h += '</ul></div>';
        }
        return h;
    }

    // ============================================================
    // Validation Dashboard — 설계 검증 대시보드
    // ============================================================
    const btnValidation = document.getElementById('btn-run-validation');
    const validationContainer = document.getElementById('validation-container');
    const validationBadge = document.getElementById('validation-summary-badge');

    if (btnValidation) {
        btnValidation.addEventListener('click', () => {
            if (!validationContainer) return;
            const checks = runAllValidationChecks();
            validationContainer.innerHTML = renderValidationDashboard(checks);
            // Summary badge
            const pass = checks.filter(c => c.status === 'pass').length;
            const warn = checks.filter(c => c.status === 'warn').length;
            const fail = checks.filter(c => c.status === 'fail').length;
            if (validationBadge) {
                validationBadge.innerHTML = '<span style="color:#4caf50">통과 '+pass+'</span> / <span style="color:#ffab00">주의 '+warn+'</span> / <span style="color:#ff5252">실패 '+fail+'</span>';
            }
            // 트리뷰에 검증 결과 전송
            vscode.postMessage({ command: 'treeUpdate', data: {
                validationPass: pass, validationWarn: warn, validationFail: fail,
            }});
        });
    }

    /**
     * 전체 검증 실행 — 각 check는 {category, item, status, value, criterion, note}
     * status: 'pass' | 'warn' | 'fail'
     */
    function runAllValidationChecks() {
        const checks = [];
        const d = _lastDesignResult;
        const la = _lastLoadAnalysis;
        const p = lastProps;
        const dsm = lastDsmResult;
        const fy = getNum('design-fy', 52.94);
        const fu = getNum('design-fu', 71.08);
        const H = getNum('tpl-H', 0), B = getNum('tpl-B', 0), D = getNum('tpl-D', 0);
        const t = getNum('tpl-t', 0), r = getNum('tpl-r', 0);

        // ════════════════════════════════════════
        // A. 단면 입력
        // ════════════════════════════════════════
        const cat = 'A. 단면 입력';

        checks.push({
            category: cat, item: '단면 정의',
            status: (model && model.node && model.node.length > 0) ? 'pass' : 'fail',
            value: model ? (model.node||[]).length + ' 절점' : '0',
            criterion: '최소 1개 절점 정의 필요',
            note: model && model.node && model.node.length > 0 ? '' : '단면 미정의 — 전처리 탭에서 템플릿을 생성하거나 절점/요소를 정의하세요.',
        });

        checks.push({
            category: cat, item: '두께 (t)',
            status: t > 0 ? (t >= toDisplay(0.018,'thickness') && t <= toDisplay(0.5,'thickness') ? 'pass' : 'warn') : 'fail',
            value: t > 0 ? t+' '+_rul('thickness') : '미설정',
            criterion: _ruv(0.018,'thickness')+' ≤ t ≤ '+_ruv(0.5,'thickness')+' '+_rul('thickness')+' (CFS 일반 범위)',
            note: t <= 0 ? '두께가 지정되지 않았습니다.' : (t < toDisplay(0.018,'thickness') ? '매우 얇음 — 재료 가용성을 확인하세요.' : (t > toDisplay(0.5,'thickness') ? '두꺼움 — 냉간성형이 아닐 수 있습니다.' : '')),
        });

        if (t > 0 && H > 0) {
            const wt_web = (H - 2*(t+r)) / t;
            checks.push({
                category: cat, item: '웹 w/t 비',
                status: wt_web <= 200 ? 'pass' : (wt_web <= 500 ? 'warn' : 'fail'),
                value: wt_web.toFixed(1),
                criterion: 'w/t ≤ 500 (Table B4.1-1 보강요소 한계), 일반 ≤200',
                note: wt_web > 500 ? 'DSM 적용 한계 초과 — Table B4.1-1.' : (wt_web > 200 ? '높은 웹 세장비 — 뒤틀림/국부좌굴이 지배합니다.' : ''),
            });
        }
        if (t > 0 && B > 0) {
            const bt_fl = (B - 2*(t+r)) / t;
            checks.push({
                category: cat, item: '플랜지 b/t 비',
                status: bt_fl <= 60 ? 'pass' : (bt_fl <= 160 ? 'warn' : 'fail'),
                value: bt_fl.toFixed(1),
                criterion: 'b/t ≤ 160 (Table B4.1-1 에지보강요소 한계)',
                note: bt_fl > 160 ? 'DSM 적용 한계 초과.' : '',
            });
        }
        if (t > 0 && D > 0) {
            const dt_lip = D / t;
            checks.push({
                category: cat, item: '립 d/t 비',
                status: dt_lip <= 60 ? 'pass' : 'fail',
                value: dt_lip.toFixed(1),
                criterion: 'd/t ≤ 60 (Table B4.1-1 비보강요소 한계)',
                note: dt_lip > 60 ? 'DSM 적용에 립이 너무 세장합니다.' : '',
            });
        }
        if (r > 0 && t > 0) {
            const Rt = r / t;
            checks.push({
                category: cat, item: '코너 R/t 비',
                status: Rt <= 10 ? 'pass' : (Rt <= 20 ? 'warn' : 'fail'),
                value: Rt.toFixed(1),
                criterion: 'R/t ≤ 20 (Table B4.1-1), 일반 ≤10',
                note: Rt > 20 ? '코너 반경 한계 초과.' : '',
            });
        }

        // ════════════════════════════════════════
        // B. 재료
        // ════════════════════════════════════════
        const catB = 'B. 재료';

        checks.push({
            category: catB, item: '항복강도 (Fy)',
            status: fy > 0 ? (fy <= toDisplay(95,'stress') ? 'pass' : 'fail') : 'fail',
            value: fy+' '+_rul('stress'),
            criterion: 'Fy ≤ '+_ruv(95,'stress')+' '+_rul('stress')+' (Table B4.1-1 Fy 한계)',
            note: fy > toDisplay(95,'stress') ? 'AISI S100 DSM Fy 한계 초과.' : (fy <= 0 ? 'Fy가 지정되지 않았습니다.' : ''),
        });

        checks.push({
            category: catB, item: 'Fu/Fy 비',
            status: fy > 0 && fu > 0 ? (fu/fy >= 1.08 ? 'pass' : 'warn') : 'fail',
            value: fy > 0 && fu > 0 ? (fu/fy).toFixed(3) : 'N/A',
            criterion: 'Fu/Fy ≥ 1.08 (§A2.3.1, §I6.2.1(o))',
            note: fu/fy < 1.08 ? '낮은 연성비 — §I6.2.1 R 계수가 적용되지 않을 수 있습니다.' : '',
        });

        checks.push({
            category: catB, item: '인장강도 (Fu)',
            status: fu > 0 ? (fu > fy ? 'pass' : 'fail') : 'fail',
            value: fu+' '+_rul('stress'),
            criterion: 'Fu > Fy',
            note: fu <= fy ? 'Fu는 Fy보다 커야 합니다.' : '',
        });

        // ════════════════════════════════════════
        // C. 좌굴 해석
        // ════════════════════════════════════════
        const catC = 'C. 좌굴 해석';

        // 반파장 설정 검증
        const lenMin = fromDisplay(getNum('input-len-min', 1), 'length');
        const lenMax = fromDisplay(getNum('input-len-max', 1000), 'length');
        const lenN = getNum('input-len-n', 50);
        const bcVal = /** @type {HTMLSelectElement} */ (document.getElementById('select-bc'))?.value || 'S-S';
        const webH = fromDisplay(getNum('tpl-H', 0), 'length'); // 웹 높이 (US in)

        // 최솟값 검증: 국부좌굴 포착을 위해 단면 최대 판폭 이하여야 함
        const localOK = webH > 0 ? (lenMin <= webH * 0.8) : (lenMin <= 5);
        checks.push({
            category: catC, item: '반파장 최솟값',
            status: localOK ? 'pass' : 'warn',
            value: _ruv(lenMin,'length')+' '+_rul('length'),
            criterion: '국부좌굴 포착을 위해 최솟값 ≤ 단면 최대 판폭(≈'+_ruv(webH,'length')+' '+_rul('length')+') 필요',
            note: !localOK ? '최솟값이 너무 큼 — 국부좌굴 곡선이 잘릴 수 있습니다. 단면 높이의 0.3~0.5배 이하로 설정하세요.' : '',
        });

        // 최댓값 검증: 전체좌굴 포착을 위해 비지지 길이 이상이어야 함
        const designLb = fromDisplay(getNum('design-Lb', 0), 'length');
        const spanTblEls2 = document.querySelectorAll('.span-tbl-len');
        const spanIn = spanTblEls2.length > 0 ? fromDisplay(parseFloat(/** @type {HTMLInputElement} */ (spanTblEls2[0]).value) || 0, 'length_ft') * 12 : 0;
        const refLen = Math.max(designLb, spanIn, 120); // 비교용 참조 길이 (in)
        const globalOK = lenMax >= refLen;
        checks.push({
            category: catC, item: '반파장 최댓값',
            status: globalOK ? (lenMax >= refLen * 1.5 ? 'pass' : 'warn') : 'fail',
            value: _ruv(lenMax,'length')+' '+_rul('length'),
            criterion: '전체좌굴 포착을 위해 최댓값 ≥ 비지지 길이(≈'+_ruv(refLen,'length')+' '+_rul('length')+') 필요. 1.5~3배 권장',
            note: !globalOK ? '최댓값이 비지지 길이보다 짧음 — 전체좌굴(LTB)이 곡선에 나타나지 않습니다. 최소 '+_ruv(refLen*1.5,'length')+' '+_rul('length')+' 이상으로 설정하세요.' : (lenMax < refLen * 1.5 ? '비지지 길이의 1.5배 미만 — 전체좌굴 영역이 부족할 수 있습니다.' : ''),
        });

        // 개수 검증
        checks.push({
            category: catC, item: '반파장 개수',
            status: lenN >= 30 ? 'pass' : 'warn',
            value: lenN + '점',
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
            status: 'pass', // 경계조건은 엔지니어 판단이므로 pass 기본
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
            status: lcOK ? 'pass' : 'warn',
            value: loadCase,
            criterion: '설계 부재유형과 해석 Load Case가 일치해야 함',
            note: lcNote,
        });

        checks.push({
            category: catC, item: '해석 실행 여부',
            status: analysisResult && analysisResult.curve ? 'pass' : 'fail',
            value: analysisResult && analysisResult.curve ? analysisResult.curve.length + ' 점' : '미실행',
            criterion: '설계 전 FSM 좌굴해석 완료 필요',
            note: !analysisResult ? '해석 탭에서 좌굴해석을 실행하세요.' : '',
        });

        const dP = dsm ? dsm.P : null;
        const dM = dsm ? dsm.Mxx : null;

        checks.push({
            category: catC, item: 'DSM 값 추출',
            status: dP || dM ? 'pass' : 'fail',
            value: dP ? 'Pcrl='+_rv(dP.Pcrl)+', Pcrd='+_rv(dP.Pcrd) : '미추출',
            criterion: 'Pcrl, Pcrd, Mcrl, Mcrd가 시그니처 곡선에서 식별되어야 함',
            note: !dP && !dM ? '해석을 먼저 실행하세요 — DSM 값은 자동 추출됩니다.' : '',
        });

        if (dM) {
            checks.push({
                category: catC, item: 'Mcrl 식별 (국부좌굴)',
                status: dM.Mxxcrl > 0 ? 'pass' : 'warn',
                value: dM.Mxxcrl > 0 ? _ruv(dM.Mxxcrl,'moment')+' '+_rul('moment')+' (L='+_ruv(dM.Lcrl,'length')+' '+_rul('length')+')' : '미발견',
                criterion: '국부좌굴 최솟값이 식별 가능해야 함',
                note: dM.Mxxcrl <= 0 ? '국부좌굴 최솟값 미발견 — 국부검토를 건너뜁니다 (Mnl=Mne).' : '',
            });
            checks.push({
                category: catC, item: 'Mcrd 식별 (뒤틀림좌굴)',
                status: dM.Mxxcrd > 0 ? 'pass' : 'warn',
                value: dM.Mxxcrd > 0 ? _ruv(dM.Mxxcrd,'moment')+' '+_rul('moment')+' (L='+_ruv(dM.Lcrd,'length')+' '+_rul('length')+')' : '미발견',
                criterion: 'C/Z 단면에서 뒤틀림좌굴 최솟값이 식별 가능해야 함',
                note: dM.Mxxcrd <= 0 ? '뒤틀림좌굴 미발견 — 뒤틀림 검토를 건너뜁니다 (Mnd=My). 에지 보강재 유무를 확인하세요.' : '',
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
            note: !p ? '전처리 탭에서 "성질 계산"을 클릭하세요.' : '',
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
        const spacing = getNum('config-spacing', 4.921);
        // config-span 요소가 없으므로 스팬 테이블에서 첫 번째 스팬 길이를 읽음
        const spanTblEls = document.querySelectorAll('.span-tbl-len');
        let spanFt = 0;
        if (spanTblEls.length > 0) {
            spanFt = parseFloat(/** @type {HTMLInputElement} */ (spanTblEls[0]).value) || 0;
        }
        const loadD = getNum('load-D-psf', 0);
        const loadLr = getNum('load-Lr-psf', 0);
        const loadS = getNum('load-S-psf', 0);
        const loadL = getNum('load-L-psf', 0);
        const loadW = getNum('load-Wu-psf', 0);

        checks.push({
            category: catE, item: '스팬 길이',
            status: spanFt > 0 ? (spanFt <= toDisplay(40,'length_ft') ? 'pass' : 'warn') : 'fail',
            value: spanFt > 0 ? spanFt+' '+_rul('length_ft') : '미설정',
            criterion: '스팬 > 0 필요; CFS 일반 ≤ '+_ruv(33,'length_ft')+' '+_rul('length_ft')+' (§I6.2.1)',
            note: spanFt <= 0 ? '스팬 길이를 설정하세요.' : (spanFt > toDisplay(33,'length_ft') ? '§I6.2.1 스팬 한계 초과 — R 계수가 적용되지 않을 수 있습니다.' : ''),
        });

        checks.push({
            category: catE, item: '분담폭 (간격)',
            status: spacing > 0 ? (spacing <= toDisplay(8,'length_ft') ? 'pass' : 'warn') : 'fail',
            value: spacing+' '+_rul('length_ft'),
            criterion: '간격 > 0; 일반 '+_ruv(4,'length_ft')+'-'+_ruv(6,'length_ft')+' '+_rul('length_ft'),
            note: spacing > toDisplay(8,'length_ft') ? '큰 간격 — 하중 분배를 확인하세요.' : '',
        });

        checks.push({
            category: catE, item: '고정하중 (D)',
            status: loadD > 0 ? 'pass' : 'warn',
            value: loadD+' '+_rul('pressure'),
            criterion: 'D > 0 예상 (자중 + 지붕재)',
            note: loadD <= 0 ? '고정하중 없음? 자중은 포함해야 합니다. 일반: '+_ruv(5,'pressure')+'-'+_ruv(15,'pressure')+' '+_rul('pressure')+'.' : '',
        });

        const hasGravity = loadLr > 0 || loadS > 0 || loadL > 0;
        checks.push({
            category: catE, item: '중력 활하중/적설하중',
            status: hasGravity ? 'pass' : 'warn',
            value: [loadLr>0?'Lr='+loadLr:'',loadS>0?'S='+loadS:'',loadL>0?'L='+loadL:''].filter(Boolean).join(', ')+' '+_rul('pressure') || '없음',
            criterion: '최소 하나의 중력 활하중 예상',
            note: !hasGravity ? '활하중/적설하중 없음 — 맞습니까?' : '',
        });

        // ════════════════════════════════════════
        // F. 하중 분석 결과 (Load Analysis Results)
        // ════════════════════════════════════════
        const catF = 'F. 하중 분석';

        checks.push({
            category: catF, item: '하중 분석 실행 여부',
            status: la ? 'pass' : 'fail',
            value: la ? '조합: '+(la.gravity?la.gravity.combo:'N/A') : '미실행',
            criterion: '설계 전 하중 분석 필요',
            note: !la ? '설계 탭에서 "하중 분석 실행"을 클릭하세요.' : '',
        });

        if (la && la.gravity && la.gravity.locations) {
            const locs = la.gravity.locations;
            const maxMu = Math.max(...locs.filter(l=>l.Mu!=null).map(l=>Math.abs(l.Mu)));
            checks.push({
                category: catF, item: '최대 Mu',
                status: maxMu > 0 ? 'pass' : 'warn',
                value: _ruv(maxMu,'moment_ft')+' '+_rul('moment_ft'),
                criterion: '중력하중 존재 시 Mu > 0 이어야 함',
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
            if (ap.negative_region) {
                checks.push({
                    category: catF, item: '비지지 길이 Ly (부모멘트)',
                    status: ap.negative_region.Ly_in > 0 ? 'pass' : 'warn',
                    value: _ruv(ap.negative_region.Ly_in,'length')+' '+_rul('length'),
                    criterion: '부모멘트 구간에서 Ly > 0 (비지지 하부 플랜지)',
                    note: ap.negative_region.Ly_in <= 0 ? '비지지 길이 0 — 부모멘트 구간이 완전 지지?' : '',
                });
                checks.push({
                    category: catF, item: '모멘트 구배 Cb',
                    status: ap.negative_region.Cb >= 1.0 ? 'pass' : 'warn',
                    value: ap.negative_region.Cb,
                    criterion: 'Cb ≥ 1.0 (AISI Eq. F2.1.1-2), 일반 1.0-2.3',
                    note: ap.negative_region.Cb < 1.0 ? 'Cb < 1.0은 비정상 — 확인하세요.' : (ap.negative_region.Cb > 2.5 ? '매우 높은 Cb — 모멘트 다이어그램 형태를 확인하세요.' : ''),
                });
            }
            if (ap.uplift_R != null) {
                checks.push({
                    category: catF, item: '양력 R 계수 (§I6.2.1)',
                    status: ap.uplift_R > 0 ? 'pass' : 'warn',
                    value: ap.uplift_R,
                    criterion: '조건 충족 시 R = 0.40-0.70 (§I6.2.1)',
                    note: ap.uplift_R === 0.60 && !la.section ? 'R=0.60은 기본값 (단면 정보 미전달) — 보수적일 수 있습니다.' : '',
                });
            }
        }

        // ── 처짐 검증 (IBC Table 1604.3) ──
        if (la && la.deflection && la.deflection.per_span) {
            // 부재 유형별 한계 처짐비
            const memberApp = document.getElementById('select-member-type');
            const mType = memberApp ? memberApp.value : '';
            // IBC Table 1604.3 기준 (활하중)
            let limitLL, limitTL, limitLabel;
            if (mType === 'floor-joist') {
                limitLL = 360; limitTL = 240; limitLabel = '바닥 장선';
            } else {
                limitLL = 240; limitTL = 180; limitLabel = '지붕 퍼린';
            }

            la.deflection.per_span.forEach((ps, idx) => {
                const ld = ps.L_over_delta;
                const ldOK = ld >= limitLL;
                checks.push({
                    category: catF, item: '처짐 — 스팬 '+(idx+1)+' (L/δ)',
                    status: ldOK ? (ld >= limitLL * 1.1 ? 'pass' : 'warn') : 'fail',
                    value: 'L/'+ld.toFixed(0)+' (δ='+_ruv(ps.abs_delta_in,'length')+' '+_rul('length')+')',
                    criterion: limitLabel+': L/δ ≥ '+limitLL+' (활하중), ≥ '+limitTL+' (전체하중) — IBC Table 1604.3',
                    note: !ldOK ? '처짐 한계 초과 (L/'+limitLL+') — 단면을 키우거나 스팬을 줄이세요.' : (ld < limitLL * 1.1 ? '한계에 근접 — 여유를 확인하세요.' : ''),
                });
            });
        } else if (la && !la.deflection) {
            checks.push({
                category: catF, item: '처짐 검토',
                status: 'warn',
                value: '미계산',
                criterion: 'IBC Table 1604.3 처짐 한계 검증 필요',
                note: '단면 성질(Ixx)이 필요합니다. 전처리 탭에서 단면을 생성하고 해석을 재실행하세요.',
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
            note: !d ? '설계 탭에서 "설계 검토 실행"을 클릭하세요.' : '',
        });

        if (d && !d.error) {
            // Mn 구성요소 검토
            if (d.member_type === 'flexure') {
                checks.push({
                    category: catG, item: 'Mne vs My',
                    status: d.Mne != null && d.My != null ? (d.Mne <= d.My ? 'pass' : 'warn') : 'fail',
                    value: 'Mne='+_rv(d.Mne)+', My='+_rv(d.My),
                    criterion: 'Mne ≤ My 예상 (LTB가 항복 이하로 감소)',
                    note: d.Mne > d.My * 1.01 ? 'Mne > My — Cb 효과가 아니면 비정상. Lb와 Cb를 확인하세요.' : '',
                });
                checks.push({
                    category: catG, item: 'Mnl vs Mne (국부좌굴 감소)',
                    status: d.Mnl != null ? (d.Mnl < d.Mne ? 'warn' : 'pass') : 'fail',
                    value: 'Mnl='+_rv(d.Mnl)+', Mne='+_rv(d.Mne),
                    criterion: 'Mnl ≤ Mne; Mnl < Mne → 국부좌굴이 강도를 감소시킴',
                    note: d.Mnl != null && d.Mnl >= d.Mne ? '국부좌굴 감소 없음 (λl ≤ 0.776).' : '국부좌굴로 강도 '+(d.Mne>0?((1-d.Mnl/d.Mne)*100).toFixed(1):'?')+'% 감소.',
                });
                checks.push({
                    category: catG, item: 'Mnd vs My (뒤틀림좌굴 감소)',
                    status: d.Mnd != null ? (d.Mnd < d.My ? 'warn' : 'pass') : 'fail',
                    value: 'Mnd='+_rv(d.Mnd)+', My='+_rv(d.My),
                    criterion: 'Mnd ≤ My; Mnd < My → 뒤틀림좌굴이 강도를 감소시킴',
                    note: d.Mnd != null && d.Mnd >= d.My ? '뒤틀림좌굴 감소 없음 (λd ≤ 0.673).' : '뒤틀림좌굴로 강도 '+(d.My>0?((1-d.Mnd/d.My)*100).toFixed(1):'?')+'% 감소.',
                });
                checks.push({
                    category: catG, item: '모든 Mn 동일 (잠재적 문제)',
                    status: (d.Mne === d.Mnl && d.Mnl === d.Mnd && d.Mnd === d.My) ? 'warn' : 'pass',
                    value: d.Mne === d.My ? 'Mne=Mnl=Mnd=My='+_rv(d.My) : '값이 상이함 (정상)',
                    criterion: '네 값 모두 같으면 DSM이 좌굴 감소를 적용하지 않을 수 있음',
                    note: (d.Mne === d.Mnl && d.Mnl === d.Mnd && d.Mnd === d.My) ? 'DSM 강도가 모두 동일 — FSM 해석에서 Mcrl/Mcrd가 올바르게 추출되었는지 확인하세요.' : '',
                });
            }

            if (d.member_type === 'compression') {
                checks.push({
                    category: catG, item: 'Pnl vs Pne (국부좌굴 감소)',
                    status: d.Pnl != null ? (d.Pnl < d.Pne ? 'warn' : 'pass') : 'fail',
                    value: 'Pnl='+_rv(d.Pnl)+', Pne='+_rv(d.Pne),
                    criterion: 'Pnl ≤ Pne; 감소 시 → 국부좌굴 지배',
                    note: '',
                });
                checks.push({
                    category: catG, item: 'Pnd vs Py (뒤틀림좌굴 감소)',
                    status: d.Pnd != null ? (d.Pnd < d.Py ? 'warn' : 'pass') : 'fail',
                    value: 'Pnd='+_rv(d.Pnd)+', Py='+_rv(d.Py),
                    criterion: 'Pnd ≤ Py; 감소 시 → 뒤틀림좌굴 지배',
                    note: '',
                });
            }

            // 이용률
            if (d.utilization != null) {
                const util = d.utilization;
                checks.push({
                    category: catG, item: '이용률 (DCR)',
                    status: util <= 0.95 ? 'pass' : (util <= 1.0 ? 'warn' : 'fail'),
                    value: (util*100).toFixed(1)+'%',
                    criterion: 'DCR ≤ 100% (여유를 위해 ≤95% 권장)',
                    note: util > 1.0 ? '과응력 — 설계 요구사항 미충족. 단면을 키우거나 하중을 줄이세요.' : (util > 0.95 ? '한계에 매우 근접 — 여유를 고려하세요.' : ''),
                });
            }

            // 안전계수
            if (d.design_method === 'LRFD') {
                checks.push({
                    category: catG, item: '저항계수 (φ)',
                    status: 'pass',
                    value: d.member_type === 'flexure' ? 'φb = 0.90' : (d.member_type === 'compression' ? 'φc = 0.85' : 'φ 적용됨'),
                    criterion: 'AISI S100-16 LRFD 저항계수',
                    note: '',
                });
            }

            // 조합 검토
            if (d.interaction) {
                checks.push({
                    category: catG, item: '조합 검토 (§H1.2)',
                    status: d.interaction.pass ? (d.interaction.total <= 0.95 ? 'pass' : 'warn') : 'fail',
                    value: _rv(d.interaction.total,4)+' ≤ 1.0',
                    criterion: 'P/Pa + Mx/Max + My/May ≤ 1.0',
                    note: d.interaction.pass ? '' : '조합 검토 실패 — 하중을 줄이거나 단면을 키우세요.',
                });
            }

            // 설계 엔진의 DSM 경고
            if (d.dsm_warnings && d.dsm_warnings.length > 0) {
                d.dsm_warnings.forEach((w, i) => {
                    checks.push({
                        category: catG, item: 'DSM 경고 #'+(i+1),
                        status: 'warn',
                        value: w,
                        criterion: 'Table B4.1-1 적용 한계',
                        note: '단면이 DSM 사전검증 한계 밖일 수 있습니다.',
                    });
                });
            }
        }

        // ════════════════════════════════════════
        // H. 설계 일관성 (Consistency)
        // ════════════════════════════════════════
        const catH = 'H. 일관성';

        // Fy 일치 여부 확인
        const fyLoad = getNum('input-fy-load', 52.94);
        checks.push({
            category: catH, item: 'Fy 일관성 (해석 vs 설계)',
            status: Math.abs(fy - fyLoad) < 0.1 ? 'pass' : 'warn',
            value: '해석 fy='+fyLoad+', 설계 Fy='+fy+' '+_rul('stress'),
            criterion: '해석 응력 fy와 설계 Fy가 일치해야 함',
            note: Math.abs(fy - fyLoad) >= 0.1 ? 'Fy 불일치 — 좌굴해석에 다른 Fy가 사용됨. 올바른 Fy로 해석을 재실행하세요.' : '',
        });

        // 현재 단면으로 해석 여부 확인
        if (model && model.node && analysisResult) {
            checks.push({
                category: catH, item: '해석 최신성',
                status: 'pass',
                value: '해석 결과 존재',
                criterion: '해석이 현재 단면 형상과 일치해야 함',
                note: '해석 후 단면이 변경되었으면 재실행하여 결과를 갱신하세요.',
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
            h += cat;
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
                h += '<td>'+c.item+'</td>';
                h += '<td style="font-family:monospace;font-size:10px">'+c.value+'</td>';
                h += '<td style="font-size:10px;color:var(--vscode-descriptionForeground)">'+c.criterion+'</td>';
                h += '</tr>';
                if (c.note) {
                    h += '<tr style="'+bg+'"><td></td><td colspan="3" style="font-size:10px;color:'+colors[c.status]+';padding:0 6px 4px;font-style:italic">→ '+c.note+'</td></tr>';
                }
            });
            h += '</table></div>';
        }
        return h;
    }

    // ============================================================
    // ============================================================
    // Design 입력값 수집/복원 (파일 저장/열기용)
    // ============================================================
    function collectAllDesignInputs() {
        const data = {};
        // Material
        data.steelGrade = document.getElementById('select-steel-grade')?.value || 'custom';
        data.fy = fromDisplay(getNum('design-fy', 52.94), 'stress');
        data.fu = fromDisplay(getNum('design-fu', 71.08), 'stress');
        // Design method
        data.designMethod = document.getElementById('select-design-method')?.value || 'LRFD';
        data.analysisMethod = document.getElementById('select-analysis-method')?.value || 'DSM';
        // Member type
        data.memberType = document.getElementById('select-member-type')?.value || 'flexure';
        // Span config
        data.spanType = document.getElementById('select-span-type')?.value || 'simple';
        data.nSpans = getNum('config-n-spans', 5);
        data.spacing = fromDisplay(getNum('config-spacing', 4.921), 'length_ft');
        // 스팬 테이블 데이터
        const spanLens = []; const sups = []; const laps = [];
        document.querySelectorAll('.span-tbl-len').forEach(el => spanLens.push(fromDisplay(parseFloat(el.value) || 25, 'length_ft')));
        document.querySelectorAll('.span-tbl-sup').forEach(el => sups.push(el.value));
        const nSup = sups.length;
        for (let i = 0; i < nSup; i++) {
            const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
            const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
            laps.push({ left: lEl ? fromDisplay(parseFloat(lEl.value) || 0, 'length_ft') : 0, right: rEl ? fromDisplay(parseFloat(rEl.value) || 0, 'length_ft') : 0 });
        }
        data.spans = spanLens;
        data.supports = sups;
        data.lapsPerSupport = laps;
        // Loads
        data.loadD = fromDisplay(getNum('load-D-psf', 0), 'pressure');
        data.loadLr = fromDisplay(getNum('load-Lr-psf', 0), 'pressure');
        data.loadS = fromDisplay(getNum('load-S-psf', 0), 'pressure');
        data.loadWu = fromDisplay(getNum('load-Wu-psf', 0), 'pressure');
        data.loadL = fromDisplay(getNum('load-L-psf', 0), 'pressure');
        // Deck
        data.deckType = document.getElementById('select-deck-type')?.value || 'none';
        data.deckTPanel = fromDisplay(getNum('deck-t-panel', 0.0197), 'thickness');
        data.deckFastenerSpacing = fromDisplay(getNum('deck-fastener-spacing', 11.81), 'length');
        data.deckKphiOverride = fromDisplay(getNum('deck-kphi-override', 0), 'rotStiff');
        // Unbraced lengths
        data.KxLx = fromDisplay(getNum('design-KxLx', 118.11), 'length');
        data.KyLy = fromDisplay(getNum('design-KyLy', 118.11), 'length');
        data.KtLt = fromDisplay(getNum('design-KtLt', 118.11), 'length');
        data.Lb = fromDisplay(getNum('design-Lb', 118.11), 'length');
        data.Cb = getNum('design-Cb', 1.0);
        data.Cmx = getNum('design-Cmx', 0.85);
        data.Cmy = getNum('design-Cmy', 0.85);
        // Required loads
        data.Pu = fromDisplay(getNum('design-P', 0), 'force');
        data.Vu = fromDisplay(getNum('design-V', 0), 'force');
        data.Mux = fromDisplay(getNum('design-Mx', 0), 'moment');
        data.Muy = fromDisplay(getNum('design-My', 0), 'moment');
        // Web crippling
        data.wcN = fromDisplay(getNum('design-wc-N', 3.504), 'length');
        data.wcR = fromDisplay(getNum('design-wc-R', 0.1875), 'radius');
        data.wcSupport = document.getElementById('design-wc-support')?.value || 'EOF';
        // Template params
        data.templateType = document.getElementById('select-template')?.value || '';
        data.tplH = fromDisplay(getNum('tpl-H', 7.874), 'length');
        data.tplB = fromDisplay(getNum('tpl-B', 2.953), 'length');
        data.tplD = fromDisplay(getNum('tpl-D', 0.787), 'length');
        data.tplT = fromDisplay(getNum('tpl-t', 0.0906), 'thickness');
        data.tplR = fromDisplay(getNum('tpl-r', 0.157), 'radius');
        data.tplQlip = getNum('tpl-qlip', 90);
        // Analysis config
        data.fyLoad = fromDisplay(getNum('input-fy-load', 52.94), 'stress');
        return data;
    }

    function restoreAllDesignInputs(data) {
        if (!data) return;
        function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
        function setSelect(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
        // Material
        if (data.steelGrade) setSelect('select-steel-grade', data.steelGrade);
        if (data.fy) setValue('design-fy', toDisplay(data.fy, 'stress'));
        if (data.fu) setValue('design-fu', toDisplay(data.fu, 'stress'));
        // Design method
        if (data.designMethod) setSelect('select-design-method', data.designMethod);
        if (data.analysisMethod) setSelect('select-analysis-method', data.analysisMethod);
        // Member type
        if (data.memberType) setSelect('select-member-type', data.memberType);
        // Span config
        if (data.spanType) {
            setSelect('select-span-type', data.spanType);
            if (data.nSpans) setValue('config-n-spans', data.nSpans);
        }
        if (data.spacing) setValue('config-spacing', toDisplay(data.spacing, 'length_ft'));
        // 스팬 테이블 재생성 후 값 복원
        if (typeof buildSpanTable === 'function') buildSpanTable();
        setTimeout(() => {
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
        // Loads
        if (data.loadD != null) setValue('load-D-psf', toDisplay(data.loadD, 'pressure'));
        if (data.loadLr != null) setValue('load-Lr-psf', toDisplay(data.loadLr, 'pressure'));
        if (data.loadS != null) setValue('load-S-psf', toDisplay(data.loadS, 'pressure'));
        if (data.loadWu != null) setValue('load-Wu-psf', toDisplay(data.loadWu, 'pressure'));
        if (data.loadL != null) setValue('load-L-psf', toDisplay(data.loadL, 'pressure'));
        // Deck
        if (data.deckType) setSelect('select-deck-type', data.deckType);
        if (data.deckTPanel) setValue('deck-t-panel', toDisplay(data.deckTPanel, 'thickness'));
        if (data.deckFastenerSpacing) setValue('deck-fastener-spacing', toDisplay(data.deckFastenerSpacing, 'length'));
        if (data.deckKphiOverride) setValue('deck-kphi-override', toDisplay(data.deckKphiOverride, 'rotStiff'));
        // Unbraced lengths
        if (data.KxLx) setValue('design-KxLx', toDisplay(data.KxLx, 'length'));
        if (data.KyLy) setValue('design-KyLy', toDisplay(data.KyLy, 'length'));
        if (data.KtLt) setValue('design-KtLt', toDisplay(data.KtLt, 'length'));
        if (data.Lb) setValue('design-Lb', toDisplay(data.Lb, 'length'));
        if (data.Cb) setValue('design-Cb', data.Cb);
        if (data.Cmx) setValue('design-Cmx', data.Cmx);
        if (data.Cmy) setValue('design-Cmy', data.Cmy);
        // Required loads
        if (data.Pu != null) setValue('design-P', toDisplay(data.Pu, 'force'));
        if (data.Vu != null) setValue('design-V', toDisplay(data.Vu, 'force'));
        if (data.Mux != null) setValue('design-Mx', toDisplay(data.Mux, 'moment'));
        if (data.Muy != null) setValue('design-My', toDisplay(data.Muy, 'moment'));
        // Web crippling
        if (data.wcN) setValue('design-wc-N', toDisplay(data.wcN, 'length'));
        if (data.wcR) setValue('design-wc-R', toDisplay(data.wcR, 'radius'));
        if (data.wcSupport) setSelect('design-wc-support', data.wcSupport);
        // Template
        if (data.templateType) setSelect('select-template', data.templateType);
        if (data.tplH) setValue('tpl-H', toDisplay(data.tplH, 'length'));
        if (data.tplB) setValue('tpl-B', toDisplay(data.tplB, 'length'));
        if (data.tplD) setValue('tpl-D', toDisplay(data.tplD, 'length'));
        if (data.tplT) setValue('tpl-t', toDisplay(data.tplT, 'thickness'));
        if (data.tplR) setValue('tpl-r', toDisplay(data.tplR, 'radius'));
        if (data.tplQlip) setValue('tpl-qlip', data.tplQlip);
        if (data.fyLoad) setValue('input-fy-load', toDisplay(data.fyLoad, 'stress'));
    }

    // 파일 저장/열기 버튼
    // ============================================================
    const btnFileOpen = document.getElementById('btn-file-open');
    const btnFileSave = document.getElementById('btn-file-save');
    if (btnFileOpen) {
        btnFileOpen.addEventListener('click', () => {
            vscode.postMessage({ command: 'openProject' });
        });
    }
    if (btnFileSave) {
        btnFileSave.addEventListener('click', () => {
            vscode.postMessage({ command: 'saveProject' });
        });
    }

    // ============================================================
    // 초기화
    // ============================================================
    vscode.postMessage({ command: 'webviewReady' });

})();
