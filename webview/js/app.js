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

    // ============================================================
    // 메시지 핸들러
    // ============================================================
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'modelLoaded':
                model = msg.data;
                renderPreprocessor();
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
                    setStatus(`Template generated: ${model.node.length} nodes, ${model.elem.length} elements`, 'success');
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
                break;
            case 'designResult':
                renderDesignResult(msg.data);
                break;
            case 'loadAnalysisComplete':
                renderLoadAnalysisResult(msg.data);
                break;
        }
    });

    // ============================================================
    // 탭 전환
    // ============================================================
    document.querySelectorAll('.tab-btn').forEach(btn => {
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
    // 전처리 렌더링
    // ============================================================
    function renderPreprocessor() {
        if (!model) { return; }
        renderNodeTable();
        renderElemTable();
        renderSectionSVG();

        // 재료 입력 초기값
        if (model.prop && model.prop.length > 0) {
            const p = model.prop[0];
            setValue('input-E', p[1]);
            setValue('input-v', p[3]);
            setValue('input-G', p[5]);
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
        svg.setAttribute('viewBox',
            `${xMin - pad} ${zMin - pad} ${xMax - xMin + 2 * pad} ${zMax - zMin + 2 * pad}`
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
                    content += `<line x1="${n1[1]}" y1="${n1[2]}" x2="${n2[1]}" y2="${n2[2]}"
                        stroke="var(--vscode-charts-blue, #4fc3f7)" stroke-width="0.15"
                        stroke-linecap="round"/>`;
                }
            });
        }

        // 절점 (원)
        model.node.forEach((n, i) => {
            content += `<circle cx="${n[1]}" cy="${n[2]}" r="0.12"
                fill="var(--vscode-charts-orange, #ff9800)"/>`;
            content += `<text x="${n[1] + 0.2}" y="${n[2] - 0.2}"
                font-size="0.4" fill="var(--vscode-descriptionForeground)">${i + 1}</text>`;
        });

        svg.innerHTML = content;
    }

    /** Cross Section Preview에 도심 좌표축 + 주축 표시 */
    function renderSectionAxes(props) {
        const svg = document.getElementById('section-svg');
        if (!svg || !props || !model || !model.node || model.node.length === 0) { return; }

        const xcg = props.xcg;
        const zcg = props.zcg;
        const thetap = (props.thetap || 0) * Math.PI / 180;

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
        // z축 (세로, SVG에서 y가 아래방향이므로 z+는 위로)
        const z1 = zcg - axLen; const z2 = zcg + axLen;
        axes += '<line x1="' + xcg + '" y1="' + z1 + '" x2="' + xcg + '" y2="' + z2 + '" stroke="#ff9800" stroke-width="0.06" stroke-dasharray="0.15,0.1" opacity="0.7"/>';
        // z축 화살표 (위로)
        axes += '<polygon points="' + xcg + ',' + z2 + ' ' + (xcg-arrSz/2) + ',' + (z2-arrSz) + ' ' + (xcg+arrSz/2) + ',' + (z2-arrSz) + '" fill="#ff9800" opacity="0.7"/>';
        axes += '<text x="' + (xcg+fs*0.3) + '" y="' + (z2+fs) + '" font-size="' + fs + '" fill="#ff9800" font-weight="bold">z</text>';
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
        const el = document.getElementById('section-props');
        if (!el) { return; }
        const rows = [
            ['A (단면적)', fmt(props.A), 'in²'],
            ['Ixx (강축 2차모멘트)', fmt(props.Ixx), 'in⁴'],
            ['Izz (약축 2차모멘트)', fmt(props.Izz), 'in⁴'],
            ['Ixz (상승적 2차모멘트)', fmt(props.Ixz), 'in⁴'],
            ['Sx (강축 단면계수)', fmt(props.Sx), 'in³'],
            ['Sz (약축 단면계수)', fmt(props.Sz), 'in³'],
            ['Zx (강축 소성단면계수)', fmt(props.Zx), 'in³'],
            ['Zz (약축 소성단면계수)', fmt(props.Zz), 'in³'],
            ['rx (강축 회전반경)', fmt(props.rx), 'in'],
            ['rz (약축 회전반경)', fmt(props.rz), 'in'],
            ['xcg (도심 x)', fmt(props.xcg), 'in'],
            ['zcg (도심 z)', fmt(props.zcg), 'in'],
            ['θp (주축 회전각)', fmt(props.thetap), '°'],
            ['I11 (제1주축)', fmt(props.I11), 'in⁴'],
            ['I22 (제2주축)', fmt(props.I22), 'in⁴'],
        ];
        let html = '<table class="props-table"><tbody>';
        rows.forEach(([name, val, unit]) => {
            html += `<tr><td>${name}</td><td style="text-align:right;font-family:monospace">${val}</td><td>${unit}</td></tr>`;
        });
        html += '</tbody></table>';
        el.innerHTML = html;

        // SVG에 좌표축 표시
        renderSectionAxes(props);
    }

    // ============================================================
    // DSM 설계값 테이블
    // ============================================================
    function renderDsmResults(data) {
        const el = document.getElementById('dsm-table-container');
        if (!el || !data) { return; }

        const dsmP = data.P;   // 축력 기준 DSM
        const dsmM = data.Mxx; // Mxx 휨 기준 DSM

        let html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<tr style="border-bottom:2px solid var(--vscode-panel-border);">';
        html += '<th style="text-align:left; padding:4px 8px;">Property</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Value</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Half-wavelength</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Load Factor</th>';
        html += '</tr>';

        if (dsmP) {
            // === 축력 (Compression) ===
            html += _dsmHeader('Compression (Axial)');
            html += _dsmRow('Py', dsmP.Py, '', '');
            html += _dsmRow('Pcrl (local)', dsmP.Pcrl, dsmP.Lcrl, dsmP.LF_local);
            html += _dsmRow('Pcrd (distortional)', dsmP.Pcrd, dsmP.Lcrd, dsmP.LF_dist);
            html += _dsmRow('Pcre (global)', dsmP.Pcre, dsmP.Lcre, dsmP.LF_global);
        }

        if (dsmM) {
            // === 휨 (Bending) ===
            html += _dsmHeader('Bending (Mxx)');
            html += _dsmRow('My', dsmM.My_xx, '', '');
            html += _dsmRow('Mcrl (local)', dsmM.Mxxcrl, dsmM.Lcrl, dsmM.LF_local);
            html += _dsmRow('Mcrd (distortional)', dsmM.Mxxcrd, dsmM.Lcrd, dsmM.LF_dist);
            html += _dsmRow('Mcre (global)', dsmM.Mxxcre, dsmM.Lcre, dsmM.LF_global);
        }

        html += '</table>';

        // 극소점 정보
        const dsm = dsmP || dsmM;
        if (dsm && dsm.n_minima !== undefined) {
            html += '<div style="margin-top:6px; font-size:11px; color:var(--vscode-descriptionForeground);">';
            html += `Detected ${dsm.n_minima} minima`;
            if (dsm.minima) {
                dsm.minima.forEach((m, i) => {
                    html += ` | Min ${i+1}: L=${m.length.toFixed(1)}, LF=${m.load_factor.toFixed(4)}`;
                });
            }
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function _dsmHeader(title) {
        return `<tr><td colspan="4" style="padding:6px 8px 2px; font-weight:700; border-top:1px solid var(--vscode-panel-border);">${title}</td></tr>`;
    }

    function _dsmRow(label, value, length, lf) {
        const v = typeof value === 'number' ? value.toFixed(2) : (value || '-');
        const l = typeof length === 'number' ? length.toFixed(2) : (length || '');
        const f = typeof lf === 'number' ? lf.toFixed(4) : (lf || '');
        return `<tr>
            <td style="padding:3px 8px;">${label}</td>
            <td style="text-align:right; padding:3px 8px; font-weight:600;">${v}</td>
            <td style="text-align:right; padding:3px 8px;">${l}</td>
            <td style="text-align:right; padding:3px 8px;">${f}</td>
        </tr>`;
    }

    // ============================================================
    // 트리 네비게이션 — showSection
    // ============================================================
    function handleShowSection(sectionId) {
        // sectionId → 탭 매핑
        const tabMap = {
            'preprocessor': 'preprocessor',
            'template': 'preprocessor',
            'material': 'preprocessor',
            'node-elem': 'preprocessor',
            'section-preview': 'preprocessor',
            'analysis': 'analysis',
            'boundary-condition': 'analysis',
            'lengths': 'analysis',
            'cfsm-settings': 'analysis',
            'run-analysis': 'analysis',
            'postprocessor': 'postprocessor',
            'buckling-curve': 'postprocessor',
            'mode-shape-2d': 'postprocessor',
            'mode-shape-3d': 'postprocessor',
            'classification': 'postprocessor',
            'plastic-surface': 'postprocessor',
            'design': 'design',
        };

        const tabId = tabMap[sectionId] || 'preprocessor';
        switchTab(tabId);

        // run-analysis 클릭 시 자동 실행
        if (sectionId === 'run-analysis') {
            const btn = document.getElementById('btn-run-analysis');
            if (btn) { btn.click(); }
        }
    }

    // ============================================================
    // 소성곡면 생성
    // ============================================================
    const btnPlastic = document.getElementById('btn-run-plastic');
    if (btnPlastic) {
        btnPlastic.addEventListener('click', () => {
            if (!model || !model.node || model.node.length === 0) { return; }
            const fy = getNum('input-fy', 50);
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
        ctx.fillText(`Py = ${(data.Py || 0).toFixed(2)}`, c1x, infoY + 14);
        ctx.fillText(`M\u2081\u2081y = ${(data.M11_y || 0).toFixed(2)}`, c1x, infoY + 30);

        ctx.fillStyle = '#ff7043';
        const c2x = 185;
        ctx.fillText(`M\u2082\u2082y = ${(data.M22_y || 0).toFixed(2)}`, c2x, infoY + 14);
        ctx.fillText(`\u03B8p = ${tp}\u00B0`, c2x, infoY + 30);

        ctx.fillStyle = '#aaa';
        const c3x = 370;
        ctx.fillText(`fy = ${fy} ksi`, c3x, infoY + 14);
        ctx.fillText(`Mxxy = ${(data.Mxx_y || 0).toFixed(2)}  Mzzy = ${(data.Mzz_y || 0).toFixed(2)}`, c3x, infoY + 30);
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
    const btnGenTemplate = document.getElementById('btn-generate-template');
    if (btnGenTemplate) {
        btnGenTemplate.addEventListener('click', () => {
            const selTemplate = document.getElementById('select-template');
            const sectionType = selTemplate ? selTemplate.value : '';
            if (!sectionType) { return; }

            const params = {
                H: getNum('tpl-H', 9),
                B: getNum('tpl-B', 5),
                D: getNum('tpl-D', 1),
                t: getNum('tpl-t', 0.1),
                r: getNum('tpl-r', 0),
            };

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
    const selLoadCase = document.getElementById('select-load-case');
    if (selLoadCase) {
        selLoadCase.addEventListener('change', () => {
            const customDiv = document.getElementById('custom-load-inputs');
            if (customDiv) {
                customDiv.style.display = selLoadCase.value === 'custom' ? 'flex' : 'none';
            }
        });
    }

    const btnRun = document.getElementById('btn-run-analysis');
    if (btnRun) {
        btnRun.addEventListener('click', () => {
            if (!model) { return; }

            const lenMin = getNum('input-len-min', 1);
            const lenMax = getNum('input-len-max', 1000);
            const lenN = getNum('input-len-n', 50);
            const neigs = getNum('input-neigs', 20);
            const BC = /** @type {HTMLSelectElement} */ (document.getElementById('select-bc'))?.value || 'S-S';

            // logspace 생성
            const lengths = logspace(Math.log10(lenMin), Math.log10(lenMax), lenN);
            const m_all = lengths.map(() => [1]);

            const E = getNum('input-E', 29500);
            const v = getNum('input-v', 0.3);
            const G = getNum('input-G', 11346);

            // 모델 업데이트
            model.prop = [[100, E, E, v, v, G]];
            model.lengths = lengths;
            model.m_all = m_all;
            model.BC = BC;
            model.neigs = neigs;

            // Load Case에 따라 stress 자동 설정
            const loadCase = /** @type {HTMLSelectElement} */ (document.getElementById('select-load-case'))?.value || 'compression';
            const fyLoad = getNum('input-fy-load', 50);

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
                const labelText = `${ext.label} = ${ext.LF.toFixed(3)} @ L=${ext.L.toFixed(1)}`;
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
            ctx.fillText('Half-wavelength (in.)', w / 2, h - 8);
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
                ctx.fillText(Math.pow(10, exp).toString(), toX(Math.pow(10, exp)), plotBottom + 16);
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
                const coordText = `L = ${dispL.toFixed(2)},  LF = ${dispLF.toFixed(4)}`;
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
            opt.textContent = row ? row[0].toFixed(1) : i;
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

    // 강재 등급 선택 시 Fy/Fu 자동 설정
    const selGrade = document.getElementById('select-steel-grade');
    if (selGrade) {
        const gradeMap = {
            'A653-33': [33,45], 'A653-50': [50,65], 'A653-55': [55,70], 'A653-80': [80,82],
            'A792-33': [33,45], 'A792-50': [50,65], 'A792-80': [80,82],
            'A1003-33': [33,45], 'A1003-50': [50,65],
        };
        selGrade.addEventListener('change', () => {
            const v = gradeMap[selGrade.value];
            if (v) {
                setValue('design-fy', v[0]);
                setValue('design-fu', v[1]);
            }
        });
    }

    // Calculator 모드 판별
    const CALC_MODES = ['roof-purlin', 'floor-joist', 'wall-girt', 'wall-stud'];
    function isCalcMode(t) { return CALC_MODES.includes(t); }

    // PSF → PLF 자동 변환
    function updatePLF() {
        const spacing = getNum('config-spacing', 5);
        ['D', 'Lr', 'S', 'Wu', 'L'].forEach(lt => {
            const psf = getNum('load-' + lt + '-psf', 0);
            const plf = Math.round(psf * spacing);
            const el = document.getElementById('load-' + lt + '-plf');
            if (el) el.textContent = '→' + plf + ' PLF';
        });
    }
    ['config-spacing', 'load-D-psf', 'load-Lr-psf', 'load-S-psf', 'load-Wu-psf', 'load-L-psf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePLF);
    });
    updatePLF();

    // Span Type에 따라 랩/N-span 필드 토글
    const selSpanType = document.getElementById('select-span-type');
    if (selSpanType) {
        function updateSpanTypeUI() {
            const st = selSpanType.value;
            const noLap = (st === 'simple' || st === 'cantilever');
            const lapRow = document.getElementById('config-lap-row');
            const nInput = document.getElementById('config-n-spans');
            if (lapRow) lapRow.style.display = noLap ? 'none' : 'flex';
            if (nInput) nInput.style.display = (st === 'cont-n') ? 'inline-block' : 'none';
        }
        selSpanType.addEventListener('change', updateSpanTypeUI);
        updateSpanTypeUI();
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
                Fy: getNum('design-fy', 50),
                Fu: getNum('design-fu', 65),
                KxLx: getNum('design-KxLx', 120),
                KyLy: getNum('design-KyLy', 120),
                KtLt: getNum('design-KtLt', 120),
                Lb: getNum('design-Lb', 120),
                Cb: getNum('design-Cb', 1.0),
                Cmx: getNum('design-Cmx', 0.85),
                Cmy: getNum('design-Cmy', 0.85),
                Pu: getNum('design-P', 0),
                Mu: getNum('design-Mx', 0),
                Mux: getNum('design-Mx', 0),
                Muy: getNum('design-My', 0),
                Vu: getNum('design-V', 0),
                Tu: getNum('design-P', 0), // tension uses same input
                wc_N: getNum('design-wc-N', 0),
                wc_R: getNum('design-wc-R', 0),
                wc_support: /** @type {HTMLSelectElement} */ (document.getElementById('design-wc-support'))?.value || 'EOF',
            };

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

            const spacing = getNum('config-spacing', 5);
            let spanType = /** @type {HTMLSelectElement} */ (document.getElementById('select-span-type'))?.value || 'simple';
            if (spanType === 'cont-n') {
                const n = getNum('config-n-spans', 5);
                spanType = 'cont-' + n;
            }
            const data = {
                member_app: memberApp,
                span_type: spanType,
                span_ft: getNum('config-span', 25),
                spacing_ft: spacing,
                loads: {
                    D: getNum('load-D-psf', 0) * spacing,
                    Lr: getNum('load-Lr-psf', 0) * spacing,
                    S: getNum('load-S-psf', 0) * spacing,
                    W: -(getNum('load-Wu-psf', 0) * spacing),  // 양력 → 음수
                    L: getNum('load-L-psf', 0) * spacing,
                },
                design_method: /** @type {HTMLSelectElement} */ (document.getElementById('select-design-method'))?.value || 'LRFD',
                laps: {
                    left_ft: getNum('config-lap-left', 0),
                    right_ft: getNum('config-lap-right', 0),
                },
                deck: {
                    type: /** @type {HTMLSelectElement} */ (document.getElementById('select-deck-type'))?.value || 'none',
                    t_panel: getNum('deck-t-panel', 0.018),
                    fastener_spacing: getNum('deck-fastener-spacing', 12),
                    kphi_override: getNum('deck-kphi-override', null) || null,
                },
            };

            btnAnalyze.textContent = 'Analyzing...';
            btnAnalyze.disabled = true;
            vscode.postMessage({ command: 'analyzeLoads', data });
        });
    }

    // M/V 다이어그램 SVG 렌더링
    function renderDiagramSVG(values, label, color, flipSign) {
        const W = 360, H = 80, PAD = 5;
        const n = values.length;
        if (n < 2) return '';

        const vals = flipSign ? values.map(v => -v) : values; // 구조관행: +M 아래
        const maxAbs = Math.max(...vals.map(v => Math.abs(v)), 0.001);
        const scaleX = (W - 2 * PAD) / (n - 1);
        const scaleY = (H / 2 - PAD) / maxAbs;
        const midY = H / 2;

        let pathD = '';
        for (let i = 0; i < n; i++) {
            const x = PAD + i * scaleX;
            const y = midY - vals[i] * scaleY;
            pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
        }

        // 채우기 영역
        let fillD = pathD + 'L' + (PAD + (n-1)*scaleX).toFixed(1) + ',' + midY + 'L' + PAD + ',' + midY + 'Z';

        return '<div style="margin:4px 0"><svg width="' + W + '" height="' + H + '" style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:3px">'
            + '<line x1="' + PAD + '" y1="' + midY + '" x2="' + (W-PAD) + '" y2="' + midY + '" stroke="var(--vscode-foreground)" stroke-opacity="0.3" stroke-dasharray="3"/>'
            + '<path d="' + fillD + '" fill="' + color + '" fill-opacity="0.15"/>'
            + '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="1.5"/>'
            + '<text x="' + PAD + '" y="12" fill="var(--vscode-foreground)" font-size="10">' + label + '</text>'
            + '<text x="' + PAD + '" y="' + (H-3) + '" fill="var(--vscode-descriptionForeground)" font-size="9">max=' + Math.max(...values).toFixed(1) + ' / min=' + Math.min(...values).toFixed(1) + '</text>'
            + '</svg></div>';
    }

    // Analyze Loads 결과 렌더링
    let _lastLoadAnalysis = null;
    function renderLoadAnalysisResult(data) {
        const el = document.getElementById('load-analysis-result');
        if (!el) return;

        if (data.error) {
            el.innerHTML = '<p style="color:var(--vscode-errorForeground)">' + data.error + '</p>';
            return;
        }

        _lastLoadAnalysis = data;
        let html = '';

        // M/V Diagram SVG
        if (data.gravity && data.gravity.M_diagram && data.gravity.M_diagram.length > 2) {
            html += renderDiagramSVG(data.gravity.M_diagram, 'Moment (kip-ft)', '#4fc3f7', true);
        }

        // 중력 지배 결과
        if (data.gravity) {
            html += '<strong>Gravity: ' + data.gravity.combo + '</strong>';
            html += '<table style="width:100%;font-size:11px;margin:4px 0"><tr style="background:var(--vscode-editor-selectionBackground)"><th>Location</th><th>Mu(k-ft)</th><th>Vu(k)</th><th>Ru(k)</th></tr>';
            for (const loc of data.gravity.locations) {
                const m = loc.Mu != null ? loc.Mu.toFixed(2) : '—';
                const v = loc.Vu != null ? loc.Vu.toFixed(2) : '—';
                const r = loc.Ru != null ? loc.Ru.toFixed(2) : '—';
                html += '<tr><td>' + loc.name + '</td><td>' + m + '</td><td>' + v + '</td><td>' + r + '</td></tr>';
            }
            html += '</table>';
        }

        // 양력 결과
        if (data.uplift) {
            html += '<strong>Uplift: ' + data.uplift.combo + '</strong>';
            html += '<table style="width:100%;font-size:11px;margin:4px 0"><tr style="background:var(--vscode-editor-selectionBackground)"><th>Location</th><th>Mu(k-ft)</th></tr>';
            for (const loc of data.uplift.locations) {
                const m = loc.Mu != null ? loc.Mu.toFixed(2) : '—';
                html += '<tr><td>' + loc.name + '</td><td>' + m + '</td></tr>';
            }
            html += '</table>';
        }

        // Auto params
        if (data.auto_params) {
            const ap = data.auto_params;
            html += '<div style="font-size:11px;margin-top:6px;padding:4px;border:1px solid var(--vscode-panel-border);border-radius:3px">';
            html += '<strong>Auto Parameters:</strong><br>';
            if (ap.deck) html += 'Deck: k&phi;=' + ap.deck.kphi + ', kx=' + ap.deck.kx + '<br>';
            if (ap.positive_region) html += 'Positive: braced=' + ap.positive_region.braced + '<br>';
            if (ap.negative_region) html += 'Negative: Ly=' + ap.negative_region.Ly_in + 'in, Cb=' + ap.negative_region.Cb + '<br>';
            if (ap.uplift_R != null) html += 'Uplift R=' + ap.uplift_R;
            html += '</div>';

            // Auto-fill required strengths into design inputs
            if (data.gravity && data.gravity.locations.length > 0) {
                // 절대값 최대 Mu 위치
                let maxLoc = data.gravity.locations[0];
                for (const loc of data.gravity.locations) {
                    if (loc.Mu != null && Math.abs(loc.Mu) > Math.abs(maxLoc.Mu || 0)) maxLoc = loc;
                }
                if (maxLoc.Mu != null) setValue('design-Mx', Math.abs(maxLoc.Mu * 12).toFixed(1));  // kip-ft → kip-in
                if (maxLoc.Vu != null) setValue('design-V', maxLoc.Vu.toFixed(2));
                // Unbraced lengths
                if (ap.negative_region) {
                    setValue('design-Lb', ap.negative_region.Ly_in || 0);
                    setValue('design-Cb', ap.negative_region.Cb || 1.0);
                }
            }
        }

        el.innerHTML = html;

        // 버튼 복원
        if (btnAnalyze) {
            btnAnalyze.textContent = '📊 Analyze Loads';
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
                    btnCopyReport.textContent = 'Copied!';
                    setTimeout(() => { btnCopyReport.textContent = 'Copy Report to Clipboard'; }, 1500);
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

        if (!summaryEl || !stepsEl) { return; }

        // 에러 처리
        if (data.error) {
            summaryEl.innerHTML = `<p style="color:var(--vscode-errorForeground)">${data.error}</p>`;
            stepsEl.innerHTML = '';
            return;
        }

        // --- Summary ---
        const mt = data.member_type || '';
        const mode = data.controlling_mode || '';
        const dm = data.design_method || 'LRFD';
        const pass = data.pass;
        const util = data.utilization;

        let summaryHtml = '<table style="width:100%;font-size:12px">';

        if (mt === 'compression') {
            summaryHtml += _summaryRow('Pn (nominal)', data.Pn, 'kips');
            summaryHtml += _summaryRow('Pne (global)', data.Pne, 'kips');
            summaryHtml += _summaryRow('Pnl (local)', data.Pnl, 'kips');
            summaryHtml += _summaryRow('Pnd (distortional)', data.Pnd, 'kips');
            summaryHtml += _summaryRow('Controlling mode', mode, '');
            if (dm === 'LRFD') {
                summaryHtml += _summaryRow('φPn', data.phi_Pn, 'kips', '#4fc3f7');
            } else {
                summaryHtml += _summaryRow('Pn/Ω', data.Pn_omega, 'kips', '#4fc3f7');
            }
        } else if (mt === 'flexure') {
            summaryHtml += _summaryRow('Mn (nominal)', data.Mn, 'kip-in');
            summaryHtml += _summaryRow('Mne (global)', data.Mne, 'kip-in');
            summaryHtml += _summaryRow('Mnl (local)', data.Mnl, 'kip-in');
            summaryHtml += _summaryRow('Mnd (distortional)', data.Mnd, 'kip-in');
            summaryHtml += _summaryRow('Controlling mode', mode, '');
            if (dm === 'LRFD') {
                summaryHtml += _summaryRow('φMn', data.phi_Mn, 'kip-in', '#4fc3f7');
            } else {
                summaryHtml += _summaryRow('Mn/Ω', data.Mn_omega, 'kip-in', '#4fc3f7');
            }
        } else if (mt === 'tension') {
            summaryHtml += _summaryRow('Tn (yield)', data.Tn_yield, 'kips');
            summaryHtml += _summaryRow('Tn (rupture)', data.Tn_rupture, 'kips');
            summaryHtml += _summaryRow('Controlling mode', mode, '');
            summaryHtml += _summaryRow('Design strength', data.design_strength, 'kips', '#4fc3f7');
        } else if (mt === 'combined') {
            const c = data.compression || {};
            const f = data.flexure_x || {};
            const fy = data.flexure_y || null;
            summaryHtml += _summaryRow('Pn', c.Pn, 'kips');
            summaryHtml += _summaryRow('Compression mode', c.controlling_mode, '');
            summaryHtml += _summaryRow('Design Pn', c.design_strength, 'kips', '#4fc3f7');
            summaryHtml += _summaryRow('Mn (x)', f.Mn, 'kip-in');
            summaryHtml += _summaryRow('Flexure mode', f.controlling_mode, '');
            summaryHtml += _summaryRow('Design Mn(x)', f.design_strength, 'kip-in', '#4fc3f7');
            if (fy) {
                summaryHtml += _summaryRow('Mn (y)', fy.Mn, 'kip-in');
                summaryHtml += _summaryRow('Design Mn(y)', fy.design_strength, 'kip-in', '#4fc3f7');
            }
            if (data.amplification) {
                const amp = data.amplification;
                summaryHtml += _summaryRow('§C1 αx', amp.alpha_x?.toFixed(3), '', '#ffab00');
                summaryHtml += _summaryRow('§C1 αy', amp.alpha_y?.toFixed(3), '', '#ffab00');
            }
            if (data.shear) {
                summaryHtml += _summaryRow('Vn', data.shear.Vn, 'kips');
                summaryHtml += _summaryRow('Design Vn', data.shear.design_strength, 'kips', '#4fc3f7');
            }
        } else if (mt === 'connection') {
            const ls = data.limit_states || [];
            ls.forEach(l => {
                const mark = l.governs ? ' *' : '';
                summaryHtml += _summaryRow(l.name + mark, l.design_strength, 'kips', l.governs ? '#ffab00' : undefined);
            });
            summaryHtml += _summaryRow('Governing', data.governing_mode, '');
            summaryHtml += _summaryRow('Design strength', data.design_strength, 'kips', '#4fc3f7');
        }

        if (util != null) {
            const clr = pass ? '#4caf50' : '#ff5252';
            summaryHtml += _summaryRow('Utilization', (util * 100).toFixed(1) + '%', '', clr);
            summaryHtml += _summaryRow('Status', pass ? 'OK' : 'NG', '', clr);
        }
        summaryHtml += '</table>';
        summaryEl.innerHTML = summaryHtml;

        // --- Steps ---
        const steps = data.steps || [];
        let stepsHtml = '';
        if (steps.length > 0) {
            steps.forEach(s => {
                const eq = s.equation ? ` <span style="color:#888">[${s.equation}]</span>` : '';
                const modeTag = s.controlling_mode ? ` <span style="color:#ffab00">← ${s.controlling_mode}</span>` : '';
                stepsHtml += `<div style="margin-bottom:6px;border-bottom:1px solid var(--vscode-panel-border,#333);padding-bottom:4px">`;
                stepsHtml += `<b>Step ${s.step}: ${s.name}</b>${eq}${modeTag}<br>`;
                stepsHtml += `<span style="color:#aaa">${s.formula || ''}</span>`;
                if (s.value != null) {
                    stepsHtml += `<br><b style="color:#4fc3f7">${s.value} ${s.unit || ''}</b>`;
                }
                stepsHtml += `</div>`;
            });
        } else if (data.limit_states) {
            // 접합부: limit_states 기반 렌더링
            data.limit_states.forEach((ls, i) => {
                const eq = ls.equation ? ` <span style="color:#888">[${ls.equation}]</span>` : '';
                const gov = ls.governs ? ` <span style="color:#ffab00">← Governing</span>` : '';
                stepsHtml += `<div style="margin-bottom:6px;border-bottom:1px solid var(--vscode-panel-border,#333);padding-bottom:4px">`;
                stepsHtml += `<b>${i+1}. ${ls.name}</b>${eq}${gov}<br>`;
                stepsHtml += `<span style="color:#aaa">${ls.formula || ''}</span>`;
                stepsHtml += `<br>Rn = <b>${ls.Rn}</b> kips → Design = <b style="color:#4fc3f7">${ls.design_strength}</b> kips`;
                stepsHtml += `</div>`;
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
                    ${_summaryRow('Pn (web crippling)', wc.Pn, 'kips')}
                    ${_summaryRow('Support', wc.support, '')}
                    ${_summaryRow('0.91(P/Pn)', h3.P_term?.toFixed(3), '')}
                    ${_summaryRow('M/Mnfo', h3.M_term?.toFixed(3), '')}
                    ${_summaryRow('Total', h3.total?.toFixed(3), '≤ ' + h3.limit?.toFixed(2), h3clr)}
                    ${_summaryRow('Result', h3.pass ? 'OK' : 'NG', '', h3clr)}
                </table>
                <p style="font-size:11px;color:#888">Eq. ${h3.equation}</p>
                </div>`;
        }

        // --- Reference ---
        if (refEl) {
            const sections = data.spec_sections || [];
            let refHtml = sections.length > 0
                ? `<p>AISI S100-16 Sections: <b>${sections.map(s => '§' + s).join(', ')}</b></p>`
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

    function _summaryRow(label, value, unit, color) {
        const style = color ? ` style="color:${color}"` : '';
        return `<tr><td style="padding:2px 6px;color:#aaa">${label}</td>
                <td style="padding:2px 6px;text-align:right"${style}><b>${value ?? '-'}</b> ${unit || ''}</td></tr>`;
    }

    // ============================================================
    // 초기화
    // ============================================================
    vscode.postMessage({ command: 'webviewReady' });

})();
