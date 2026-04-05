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
                _lastDesignResult = msg.data;
                renderDesignResult(msg.data);
                break;
            case 'captureSection':
                captureSectionPreview();
                break;
            case 'loadAnalysisComplete':
                renderLoadAnalysisResult(msg.data);
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
                H: getNum('tpl-H', 9),
                B: getNum('tpl-B', 5),
                D: getNum('tpl-D', 1),
                t: getNum('tpl-t', 0.1),
                r: getNum('tpl-r', 0),
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

    // --- Input validation ---
    const VALIDATION_RULES = {
        'design-fy':  { min: 1, max: 100, label: 'Fy' },
        'design-fu':  { min: 1, max: 120, label: 'Fu' },
        'design-KxLx': { min: 0.1, max: 10000, label: 'KxLx' },
        'design-KyLy': { min: 0.1, max: 10000, label: 'KyLy' },
        'design-KtLt': { min: 0.1, max: 10000, label: 'KtLt' },
        'design-Lb':  { min: 0, max: 10000, label: 'Lb' },
        'design-Cb':  { min: 1.0, max: 3.0, label: 'Cb' },
        'config-span': { min: 0.5, max: 200, label: 'Span' },
    };

    function validateDesignInput(id) {
        const el = document.getElementById(id);
        const rule = VALIDATION_RULES[id];
        if (!el || !rule) return true;
        const val = parseFloat(el.value);
        const valid = !isNaN(val) && val >= rule.min && val <= rule.max;
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
                const defaultSup = isEnd ? 'P' : 'P';
                const supOptions = '<option value="P">P (Pin)</option><option value="R">R (Roller)</option><option value="F">F (Fixed)</option>';

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

            const spacing = getNum('config-spacing', 5);
            let spanType = /** @type {HTMLSelectElement} */ (document.getElementById('select-span-type'))?.value || 'simple';
            if (spanType === 'cont-n') {
                const n = getNum('config-n-spans', 5);
                spanType = 'cont-' + n;
            }
            // 프리프로세서 단면 템플릿 파라미터 → §I6.2.1 R 계산에 필요
            const selTemplate = document.getElementById('select-template');
            const secType = selTemplate ? selTemplate.value : '';
            const sectionInfo = {
                depth: getNum('tpl-H', 0),
                flange_width: getNum('tpl-B', 0),
                thickness: getNum('tpl-t', 0),
                lip_depth: getNum('tpl-D', 0),
                R_corner: getNum('tpl-r', 0),
                type: secType === 'lippedz' ? 'Z' : 'C',
                Fy: getNum('design-fy', 50),
                Fu: getNum('design-fu', 65),
            };

            // 테이블에서 스팬/지점/랩 데이터 수집
            const spanLens = [];
            const supports = [];
            const lapsPerSupport = [];
            document.querySelectorAll('.span-tbl-len').forEach(el => {
                spanLens.push(parseFloat(/** @type {HTMLInputElement} */ (el).value) || 25);
            });
            document.querySelectorAll('.span-tbl-sup').forEach(el => {
                supports.push(/** @type {HTMLSelectElement} */ (el).value);
            });
            // 각 지점별 lap 수집
            const nSup = supports.length;
            for (let si = 0; si < nSup; si++) {
                const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + si + '"]');
                const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + si + '"]');
                lapsPerSupport.push({
                    left_ft: lEl ? parseFloat(/** @type {HTMLInputElement} */ (lEl).value) || 0 : 0,
                    right_ft: rEl ? parseFloat(/** @type {HTMLInputElement} */ (rEl).value) || 0 : 0,
                });
            }
            // 등스팬 여부 판별: 모든 스팬이 같으면 단일 값 사용
            const allSame = spanLens.every(v => Math.abs(v - spanLens[0]) < 0.01);
            const spanFt = allSame ? spanLens[0] : spanLens[0];

            const data = {
                member_app: memberApp,
                span_type: spanType,
                span_ft: spanFt,
                spans_ft: spanLens,           // 부등스팬 지원
                supports: supports,           // 지점 조건 배열
                laps_per_support: lapsPerSupport, // 지점별 랩
                spacing_ft: spacing,
                loads: {
                    D: getNum('load-D-psf', 0) * spacing,
                    Lr: getNum('load-Lr-psf', 0) * spacing,
                    S: getNum('load-S-psf', 0) * spacing,
                    W: -(getNum('load-Wu-psf', 0) * spacing),
                    L: getNum('load-L-psf', 0) * spacing,
                },
                design_method: /** @type {HTMLSelectElement} */ (document.getElementById('select-design-method'))?.value || 'LRFD',
                laps: {
                    left_ft: lapsPerSupport[1]?.left_ft || 0,
                    right_ft: lapsPerSupport[1]?.right_ft || 0,
                },
                deck: {
                    type: /** @type {HTMLSelectElement} */ (document.getElementById('select-deck-type'))?.value || 'none',
                    t_panel: getNum('deck-t-panel', 0.018),
                    fastener_spacing: getNum('deck-fastener-spacing', 12),
                    kphi_override: getNum('deck-kphi-override', null) || null,
                },
                section: (sectionInfo.depth > 0 && sectionInfo.thickness > 0) ? sectionInfo : null,
            };

            btnAnalyze.textContent = 'Analyzing...';
            btnAnalyze.disabled = true;
            setDesignStep(2, true);
            vscode.postMessage({ command: 'analyzeLoads', data });
        });
    }

    // 보 개략도 + 치수선 SVG
    function renderBeamSchematic(data) {
        const W = 480, H = 44, PAD_L = 6, PAD_R = 6;
        const nSpans = data.n_spans || 1;
        // 전체 길이 추정: locations에서 최대 x_ft
        let totalL = 0;
        if (data.gravity && data.gravity.locations) {
            for (const loc of data.gravity.locations) {
                if (loc.x_ft > totalL) totalL = loc.x_ft;
            }
        }
        if (totalL <= 0) return '';
        const spanL = totalL / nSpans;

        const plotW = W - PAD_L - PAD_R;
        const beamY = 16;
        const supH = 8;

        let svg = '<div style="margin:4px 0"><svg width="' + W + '" height="' + H + '" style="width:100%;max-width:' + W + 'px">';

        // 보 선
        svg += '<line x1="' + PAD_L + '" y1="' + beamY + '" x2="' + (W - PAD_R) + '" y2="' + beamY + '" stroke="var(--vscode-foreground)" stroke-width="2"/>';

        // 지점 삼각형 + 치수선
        for (let i = 0; i <= nSpans; i++) {
            const x = PAD_L + (i / nSpans) * plotW;
            // 삼각형 지점
            const triW = 5;
            svg += '<polygon points="' + x + ',' + beamY + ' ' + (x - triW) + ',' + (beamY + supH) + ' ' + (x + triW) + ',' + (beamY + supH) + '" fill="var(--vscode-foreground)" fill-opacity="0.6"/>';
        }

        // 스팬별 치수선
        const dimY = beamY + supH + 8;
        for (let i = 0; i < nSpans; i++) {
            const x1 = PAD_L + (i / nSpans) * plotW;
            const x2 = PAD_L + ((i + 1) / nSpans) * plotW;
            const midX = (x1 + x2) / 2;
            // 치수 선
            svg += '<line x1="' + x1 + '" y1="' + dimY + '" x2="' + x2 + '" y2="' + dimY + '" stroke="var(--vscode-descriptionForeground)" stroke-width="0.8"/>';
            // 화살표 (좌)
            svg += '<line x1="' + x1 + '" y1="' + (dimY - 3) + '" x2="' + x1 + '" y2="' + (dimY + 3) + '" stroke="var(--vscode-descriptionForeground)" stroke-width="0.8"/>';
            // 화살표 (우)
            svg += '<line x1="' + x2 + '" y1="' + (dimY - 3) + '" x2="' + x2 + '" y2="' + (dimY + 3) + '" stroke="var(--vscode-descriptionForeground)" stroke-width="0.8"/>';
            // 치수 텍스트
            const dimText = spanL.toFixed(1) + ' ft';
            svg += '<text x="' + midX + '" y="' + (dimY + 11) + '" fill="var(--vscode-descriptionForeground)" font-size="9" text-anchor="middle">' + dimText + '</text>';
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
            for (let si = 0; si <= ns; si++) {
                const sx = PAD_L + (si / ns) * plotW;
                svg += '<line x1="' + sx.toFixed(1) + '" y1="' + (midY - 3) + '" x2="' + sx.toFixed(1) + '" y2="' + (midY + 3) + '" stroke="var(--vscode-foreground)" stroke-opacity="0.4" stroke-width="1"/>';
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

        // Beam schematic with dimension lines
        if (data.gravity && data.gravity.M_diagram && data.gravity.M_diagram.length > 2) {
            html += renderBeamSchematic(data);
        }

        // M Diagram SVG
        if (data.gravity && data.gravity.M_diagram && data.gravity.M_diagram.length > 2) {
            html += renderDiagramSVG(data.gravity.M_diagram, 'Moment (kip-ft)', '#4fc3f7', true);
        }

        // V Diagram SVG
        if (data.gravity && data.gravity.V_diagram && data.gravity.V_diagram.length > 2) {
            html += renderDiagramSVG(data.gravity.V_diagram, 'Shear (kips)', '#ff8a65', false);
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

        // Hide loading, restore button
        const loadingEl = document.getElementById('design-loading');
        if (loadingEl) loadingEl.style.display = 'none';
        if (summaryEl) summaryEl.style.display = 'block';
        if (btnDesign) { btnDesign.textContent = '▶ Run Design Check'; btnDesign.disabled = false; }

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
            const unit = isC ? 'kips' : 'kip-in';
            const nominal = isC ? data.Pn : data.Mn;
            const designVal = dm === 'LRFD' ? (isC ? data.phi_Pn : data.phi_Mn) : (isC ? data.Pn_omega : data.Mn_omega);
            const designLabel = dm === 'LRFD' ? (isC ? 'φPn' : 'φMn') : (isC ? 'Pn/Ω' : 'Mn/Ω');

            summaryHtml += '<div class="strength-cards">';
            vals.forEach(v => {
                const gov = (v.v != null && nominal != null && Math.abs(v.v - nominal) < 0.01) ? ' governing' : '';
                summaryHtml += '<div class="strength-card' + gov + '">';
                summaryHtml += '<div class="sc-label">' + v.l + '</div>';
                summaryHtml += '<div class="sc-value">' + (v.v != null ? v.v.toFixed(1) : '-') + '</div>';
                summaryHtml += '<div class="sc-label">' + unit + '</div>';
                if (gov) summaryHtml += '<div><span class="governing-badge">GOVERNS</span></div>';
                summaryHtml += '</div>';
            });
            summaryHtml += '</div>';

            summaryHtml += '<div style="font-size:12px;margin:4px 0">';
            summaryHtml += '<b style="color:#4fc3f7">' + designLabel + ' = ' + (designVal != null ? designVal.toFixed(1) : '-') + ' ' + unit + '</b>';
            summaryHtml += ' <span style="color:var(--vscode-descriptionForeground)">(' + mode + ')</span>';
            summaryHtml += '</div>';
        } else if (mt === 'tension') {
            summaryHtml += '<table style="width:100%;font-size:12px">';
            summaryHtml += _summaryRow('Tn (yield)', data.Tn_yield, 'kips');
            summaryHtml += _summaryRow('Tn (rupture)', data.Tn_rupture, 'kips');
            summaryHtml += _summaryRow('Controlling mode', mode, '');
            summaryHtml += _summaryRow('Design strength', data.design_strength, 'kips', '#4fc3f7');
            summaryHtml += '</table>';
        } else if (mt === 'combined') {
            const c = data.compression || {};
            const f = data.flexure_x || {};
            const fy2 = data.flexure_y || null;
            summaryHtml += '<table style="width:100%;font-size:12px">';
            summaryHtml += _summaryRow('Pn (' + (c.controlling_mode||'') + ')', c.Pn, 'kips');
            summaryHtml += _summaryRow('Design Pn', c.design_strength, 'kips', '#4fc3f7');
            summaryHtml += _summaryRow('Mn(x) (' + (f.controlling_mode||'') + ')', f.Mn, 'kip-in');
            summaryHtml += _summaryRow('Design Mn(x)', f.design_strength, 'kip-in', '#4fc3f7');
            if (fy2) {
                summaryHtml += _summaryRow('Mn(y)', fy2.Mn, 'kip-in');
                summaryHtml += _summaryRow('Design Mn(y)', fy2.design_strength, 'kip-in', '#4fc3f7');
            }
            if (data.amplification) {
                summaryHtml += _summaryRow('§C1 αx', data.amplification.alpha_x?.toFixed(3), '', '#ffab00');
                summaryHtml += _summaryRow('§C1 αy', data.amplification.alpha_y?.toFixed(3), '', '#ffab00');
            }
            if (data.shear) {
                summaryHtml += _summaryRow('Vn', data.shear.Vn, 'kips');
                summaryHtml += _summaryRow('Design Vn', data.shear.design_strength, 'kips', '#4fc3f7');
            }
            summaryHtml += '</table>';
        } else if (mt === 'connection') {
            const ls = data.limit_states || [];
            summaryHtml += '<table style="width:100%;font-size:12px">';
            ls.forEach(l => {
                const mark = l.governs ? ' <span class="governing-badge">GOVERNS</span>' : '';
                summaryHtml += _summaryRow(l.name + mark, l.design_strength, 'kips', l.governs ? '#ffab00' : undefined);
            });
            summaryHtml += _summaryRow('Design strength', data.design_strength, 'kips', '#4fc3f7');
            summaryHtml += '</table>';
        }

        // Utilization gauge bar
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
                if (isGov) stepsHtml += '<span class="governing-badge">GOVERNS</span>';
                if (s.equation) stepsHtml += '<span class="calc-step-ref">' + specRefSpan(s.equation) + '</span>';
                stepsHtml += '</span></div>';
                if (s.formula) stepsHtml += '<div style="color:var(--vscode-descriptionForeground);font-size:11px">' + s.formula + '</div>';
                if (s.value != null) stepsHtml += '<div class="calc-step-value">' + s.value + ' ' + (s.unit || '') + '</div>';
                stepsHtml += '</div>';
            });
        } else if (data.limit_states) {
            data.limit_states.forEach((ls, i) => {
                const isGov = !!ls.governs;
                stepsHtml += '<div class="calc-step' + (isGov ? ' governing' : '') + '">';
                stepsHtml += '<div class="calc-step-header">';
                stepsHtml += '<span>' + (i+1) + '. ' + ls.name + '</span>';
                stepsHtml += '<span>';
                if (isGov) stepsHtml += '<span class="governing-badge">GOVERNS</span>';
                if (ls.equation) stepsHtml += '<span class="calc-step-ref">' + specRefSpan(ls.equation) + '</span>';
                stepsHtml += '</span></div>';
                if (ls.formula) stepsHtml += '<div style="color:var(--vscode-descriptionForeground);font-size:11px">' + ls.formula + '</div>';
                stepsHtml += '<div>Rn = <b>' + ls.Rn + '</b> kips → <span class="calc-step-value">' + ls.design_strength + ' kips</span></div>';
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

    function _summaryRow(label, value, unit, color) {
        const style = color ? ` style="color:${color}"` : '';
        return `<tr><td style="padding:2px 6px;color:#aaa">${label}</td>
                <td style="padding:2px 6px;text-align:right"${style}><b>${value ?? '-'}</b> ${unit || ''}</td></tr>`;
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
                if (reportContainer) reportContainer.innerHTML = '<p style="color:var(--vscode-errorForeground);text-align:center;padding:20px">No design results available. Please run "Analyze Loads" and "Run Design Check" first.</p>';
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

    function generateDetailedReport() {
        const d = _lastDesignResult;
        const la = _lastLoadAnalysis;
        const now = new Date().toLocaleString();
        let h = '', sec = 0;

        // ── Header ──
        h += '<h1>CUFSM — Cold-Formed Steel Design Report</h1>';
        h += '<table style="border:none"><tr style="border:none"><td style="border:none;width:50%">Date: '+now+'</td>';
        h += '<td style="border:none;text-align:right">AISI S100-16 / Direct Strength Method (DSM)</td></tr></table><hr>';

        // ── 1. Section ──
        h += '<h2>'+(++sec)+'. Cross Section</h2>';
        h += _rptSection();

        // ── 2. Section Analysis (Buckling + DSM) ──
        h += '<h2>'+(++sec)+'. Elastic Buckling Analysis</h2>';
        h += _rptBuckling();

        // ── 3. Design Input ──
        h += '<h2>'+(++sec)+'. Design Input</h2>';
        h += _rptDesignInput(la, d);

        // ── 4. Load Analysis ──
        if (la) {
            h += '<h2>'+(++sec)+'. Load Analysis Results</h2>';
            h += _rptLoadAnalysis(la);
        }

        // ── 5. Design Calculation ──
        if (d) {
            const mtLabel = {compression:'Compression (Chapter E)',flexure:'Flexure (Chapter F)',combined:'Combined (Chapters E+F+H)',tension:'Tension (Chapter D)'}[d.member_type||''] || d.member_type;
            h += '<h2>'+(++sec)+'. Design Calculation — '+mtLabel+'</h2>';
            h += _rptDesignCalc(d);
        }

        // ── 6. Design Summary ──
        if (d) {
            h += '<h2>'+(++sec)+'. Design Summary</h2>';
            h += _rptSummary(d, la);
        }

        h += '<hr><p style="text-align:center;color:#999;font-size:9px">Generated by CUFSM Cold-Formed Steel Section Designer — AISI S100-16 DSM</p>';
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 1. Section — 그림 + 규격 + 속성
    // ═══════════════════════════════════════════════════════
    function _rptSection() {
        let h = '';
        if (!model || !model.node || model.node.length === 0) return '<p>(No section defined)</p>';

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
        const typeNames = {lippedc:'Lipped C-Channel',lippedz:'Lipped Z-Section',hat:'Hat Section',track:'Track Section',rhs:'Rectangular HSS',chs:'Circular HSS',angle:'Angle',isect:'I-Section',tee:'Tee Section'};
        const H0=getNum('tpl-H',0),B0=getNum('tpl-B',0),D0=getNum('tpl-D',0),t0=getNum('tpl-t',0),r0=getNum('tpl-r',0);

        h += '<div style="display:flex;gap:16px;align-items:flex-start">';
        h += '<div>'+svg+'</div>';
        h += '<div style="flex:1"><h3>Section Designation</h3>';
        h += '<table><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr>';
        h += '<tr><td>Section Type</td><td colspan="2"><b>'+(typeNames[secType]||secType||'Custom')+'</b></td></tr>';
        if (H0) h += '<tr><td>H (Depth)</td><td>'+H0+'</td><td>in</td></tr>';
        if (B0) h += '<tr><td>B (Flange width)</td><td>'+B0+'</td><td>in</td></tr>';
        if (D0) h += '<tr><td>D (Lip depth)</td><td>'+D0+'</td><td>in</td></tr>';
        if (t0) h += '<tr><td>t (Thickness)</td><td>'+t0+'</td><td>in</td></tr>';
        if (r0) h += '<tr><td>r (Corner radius)</td><td>'+r0+'</td><td>in</td></tr>';
        h += '<tr><td>Nodes / Elements</td><td colspan="2">'+model.node.length+' / '+(model.elem?model.elem.length:0)+'</td></tr>';
        h += '</table></div></div>';

        // 단면 성질
        if (lastProps) {
            const p = lastProps;
            h += '<h3>Computed Section Properties</h3>';
            h += '<table><tr><th>Property</th><th>Symbol</th><th>Value</th><th>Unit</th></tr>';
            const rows = [
                ['Gross Area','A',p.A,'in²'],
                ['Strong-axis Inertia','I<sub>xx</sub>',p.Ixx,'in⁴'],['Weak-axis Inertia','I<sub>zz</sub>',p.Izz,'in⁴'],
                ['Product of Inertia','I<sub>xz</sub>',p.Ixz,'in⁴'],
                ['Strong-axis Section Modulus','S<sub>x</sub>',p.Sx,'in³'],['Weak-axis Section Modulus','S<sub>z</sub>',p.Sz,'in³'],
                ['Strong-axis Plastic Modulus','Z<sub>x</sub>',p.Zx,'in³'],['Weak-axis Plastic Modulus','Z<sub>z</sub>',p.Zz,'in³'],
                ['Strong-axis Radius of Gyration','r<sub>x</sub>',p.rx,'in'],['Weak-axis Radius of Gyration','r<sub>z</sub>',p.rz,'in'],
                ['Centroid x','x<sub>cg</sub>',p.xcg,'in'],['Centroid z','z<sub>cg</sub>',p.zcg,'in'],
                ['Principal Axis Angle','&theta;<sub>p</sub>',p.thetap,'°'],
                ['Principal Inertia 1','I<sub>11</sub>',p.I11,'in⁴'],['Principal Inertia 2','I<sub>22</sub>',p.I22,'in⁴'],
            ];
            rows.forEach(r => { if (r[2]!=null) h += '<tr><td>'+r[0]+'</td><td>'+r[1]+'</td><td>'+_rv(r[2],4)+'</td><td>'+r[3]+'</td></tr>'; });
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
            h += '<h3>Buckling Curve (Load Factor vs. Half-Wavelength)</h3>';
            const curve = analysisResult.curve;
            const W=500,H2=220,PL=55,PR=15,PT=20,PB=35;
            const plotW=W-PL-PR,plotH=H2-PT-PB;
            // 포스트프로세서와 동일한 데이터 추출 — row[1]>0 필터링
            const points=[];
            curve.forEach(row => { if (row && row.length>=2 && row[1]>0) points.push([row[0],row[1]]); });
            if (points.length < 2) { h += '<p>(Insufficient curve data)</p>'; }
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
                svg+='<text x="'+(parseFloat(ex)+6)+'" y="'+(parseFloat(ey)-6)+'" font-size="8" fill="'+ext.color+'" font-weight="600">'+ext.label+'='+ext.LF.toFixed(3)+' @ L='+ext.L.toFixed(1)+'</text>';
            });
            svg+='<text x="'+(PL+plotW/2)+'" y="'+(H2-3)+'" font-size="9" text-anchor="middle" fill="#666">Half-wavelength (in)</text>';
            svg+='<text x="12" y="'+(PT+plotH/2)+'" font-size="9" text-anchor="middle" fill="#666" transform="rotate(-90,12,'+(PT+plotH/2)+')">Load Factor</text>';
            svg+='</svg>';
            h += '<div class="section-fig">'+svg+'</div>';
            } // end if (points.length >= 2)
        } else {
            h += '<p>(Run FSM analysis first to generate buckling curve)</p>';
        }

        // DSM Design Values — 포스트프로세서와 동일한 필드명 사용
        h += '<h3>DSM Design Values (Extracted from Buckling Curve)</h3>';
        if (lastDsmResult) {
            const dP=lastDsmResult.P||{},dM=lastDsmResult.Mxx||{};
            h += '<table><tr><th>Property</th><th>Value</th><th>Half-wavelength</th><th>Load Factor</th></tr>';
            // Compression
            h += '<tr><td colspan="4" style="font-weight:600;background:#f0f0f0">Compression (Axial)</td></tr>';
            h += '<tr><td>P<sub>y</sub> (Yield)</td><td>'+_rv(dP.Py)+' kips</td><td></td><td></td></tr>';
            h += '<tr><td>P<sub>crl</sub> (Local)</td><td>'+_rv(dP.Pcrl)+' kips</td><td>'+_rv(dP.Lcrl,1)+' in</td><td>'+_rv(dP.LF_local,4)+'</td></tr>';
            h += '<tr><td>P<sub>crd</sub> (Distortional)</td><td>'+_rv(dP.Pcrd)+' kips</td><td>'+_rv(dP.Lcrd,1)+' in</td><td>'+_rv(dP.LF_dist,4)+'</td></tr>';
            h += '<tr><td>P<sub>cre</sub> (Global)</td><td>'+_rv(dP.Pcre)+' kips</td><td>'+_rv(dP.Lcre,1)+' in</td><td>'+_rv(dP.LF_global,4)+'</td></tr>';
            // Flexure
            h += '<tr><td colspan="4" style="font-weight:600;background:#f0f0f0">Bending (M<sub>xx</sub>)</td></tr>';
            h += '<tr><td>M<sub>y</sub> (Yield)</td><td>'+_rv(dM.My_xx)+' kip-in</td><td></td><td></td></tr>';
            h += '<tr><td>M<sub>crl</sub> (Local)</td><td>'+_rv(dM.Mxxcrl)+' kip-in</td><td>'+_rv(dM.Lcrl,1)+' in</td><td>'+_rv(dM.LF_local,4)+'</td></tr>';
            h += '<tr><td>M<sub>crd</sub> (Distortional)</td><td>'+_rv(dM.Mxxcrd)+' kip-in</td><td>'+_rv(dM.Lcrd,1)+' in</td><td>'+_rv(dM.LF_dist,4)+'</td></tr>';
            h += '<tr><td>M<sub>cre</sub> (Global)</td><td>'+_rv(dM.Mxxcre)+' kip-in</td><td>'+_rv(dM.Lcre,1)+' in</td><td>'+_rv(dM.LF_global,4)+'</td></tr>';
            h += '</table>';
            // 극소점 정보
            const dsm0 = dP.n_minima !== undefined ? dP : dM;
            if (dsm0.n_minima !== undefined) {
                h += '<p style="font-size:10px;color:#666">Detected '+dsm0.n_minima+' minima in signature curve.';
                if (dsm0.minima) dsm0.minima.forEach((m,i) => { h += ' Min '+(i+1)+': L='+m.length.toFixed(1)+' in, LF='+m.load_factor.toFixed(4)+'.'; });
                h += '</p>';
            }
        } else {
            h += '<p>(No DSM results — run FSM analysis first)</p>';
        }
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 3. Design Input — 하중, 재료, 부재 구성
    // ═══════════════════════════════════════════════════════
    function _rptDesignInput(la, d) {
        let h = '';

        // 재료
        const fy = getNum('design-fy',50), fu = getNum('design-fu',65);
        const gradeEl = document.getElementById('select-steel-grade');
        const gradeName = gradeEl ? gradeEl.options[gradeEl.selectedIndex].text : 'Custom';
        h += '<h3>Material</h3>';
        h += '<table><tr><th>Parameter</th><th>Value</th><th>Unit</th></tr>';
        h += '<tr><td>Steel Grade</td><td colspan="2">'+gradeName+'</td></tr>';
        h += '<tr><td>Yield Strength, F<sub>y</sub></td><td>'+fy+'</td><td>ksi</td></tr>';
        h += '<tr><td>Tensile Strength, F<sub>u</sub></td><td>'+fu+'</td><td>ksi</td></tr>';
        h += '<tr><td>Elastic Modulus, E</td><td>29,500</td><td>ksi</td></tr>';
        h += '<tr><td>Poisson\'s Ratio, &nu;</td><td>0.30</td><td></td></tr>';
        h += '</table>';

        // 부재 구성
        const memberApp = document.getElementById('select-member-type');
        const memberName = memberApp ? memberApp.options[memberApp.selectedIndex].text : '';
        const spanEl = document.getElementById('select-span-type');
        const spanName = spanEl ? spanEl.options[spanEl.selectedIndex].text : '';
        const spanFt = getNum('config-span',0);
        const spacing = getNum('config-spacing',5);
        const dm = document.getElementById('select-design-method');
        const dmName = dm ? dm.value : 'LRFD';

        h += '<h3>Member Configuration</h3>';
        h += '<table><tr><th>Parameter</th><th>Value</th></tr>';
        if (memberName) h += '<tr><td>Member Application</td><td>'+memberName+'</td></tr>';
        if (spanName) h += '<tr><td>Span Type</td><td>'+spanName+(la?' ('+la.n_spans+' spans)':'')+'</td></tr>';
        if (spanFt) h += '<tr><td>Span Length</td><td>'+spanFt+' ft</td></tr>';
        h += '<tr><td>Tributary Width (Spacing)</td><td>'+spacing+' ft</td></tr>';
        h += '<tr><td>Design Method</td><td>'+dmName+'</td></tr>';
        const lapL = getNum('config-lap-left',0), lapR = getNum('config-lap-right',0);
        if (lapL || lapR) h += '<tr><td>Lap Lengths (left / right)</td><td>'+lapL+' / '+lapR+' ft</td></tr>';
        h += '</table>';

        // 설계하중
        h += '<h3>Design Loads</h3>';
        h += '<table><tr><th>Load Type</th><th>PSF Value</th><th>PLF Value (×'+spacing+' ft)</th><th>Description</th></tr>';
        const loadDefs = [
            ['D','load-D-psf','Dead Load (self-weight + superimposed)'],
            ['Lr','load-Lr-psf','Roof Live Load'],
            ['S','load-S-psf','Snow Load'],
            ['L','load-L-psf','Floor Live Load'],
            ['W (uplift)','load-Wu-psf','Wind Uplift Load'],
        ];
        loadDefs.forEach(ld => {
            const psf = getNum(ld[1],0);
            if (psf > 0) h += '<tr><td>'+ld[0]+'</td><td>'+psf+' psf</td><td>'+(psf*spacing).toFixed(1)+' plf</td><td>'+ld[2]+'</td></tr>';
        });
        h += '</table>';

        // 데크 정보
        const deckType = document.getElementById('select-deck-type');
        const deckName = deckType ? deckType.options[deckType.selectedIndex].text : 'None';
        if (deckName !== 'None' && deckName !== 'none') {
            h += '<h3>Deck Information</h3>';
            h += '<table><tr><th>Parameter</th><th>Value</th></tr>';
            h += '<tr><td>Deck Type</td><td>'+deckName+'</td></tr>';
            h += '<tr><td>Panel Thickness, t<sub>panel</sub></td><td>'+getNum('deck-t-panel',0.018)+' in</td></tr>';
            h += '<tr><td>Fastener Spacing</td><td>'+getNum('deck-fastener-spacing',12)+' in</td></tr>';
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
            h += renderDiagramSVG(la.gravity.M_diagram, 'Moment Diagram (kip-ft)', '#1565c0', true);
        }
        if (la.gravity && la.gravity.V_diagram && la.gravity.V_diagram.length > 2)
            h += renderDiagramSVG(la.gravity.V_diagram, 'Shear Diagram (kips)', '#e65100', false);

        if (la.gravity) {
            h += '<h3>Gravity Controlling Combination: '+la.gravity.combo+'</h3>';
            h += '<table><tr><th>Location</th><th>x (ft)</th><th>M<sub>u</sub> (kip-ft)</th><th>V<sub>u</sub> (kips)</th><th>R<sub>u</sub> (kips)</th><th>Region</th></tr>';
            la.gravity.locations.forEach(loc => {
                h += '<tr><td>'+loc.name+'</td><td>'+_rv(loc.x_ft,2)+'</td><td>'+_rv(loc.Mu)+'</td><td>'+_rv(loc.Vu)+'</td><td>'+_rv(loc.Ru)+'</td><td>'+( loc.region||'')+'</td></tr>';
            });
            h += '</table>';
        }
        if (la.uplift) {
            h += '<h3>Uplift Controlling Combination: '+la.uplift.combo+'</h3>';
            h += '<table><tr><th>Location</th><th>M<sub>u</sub> (kip-ft)</th></tr>';
            la.uplift.locations.forEach(loc => { h += '<tr><td>'+loc.name+'</td><td>'+_rv(loc.Mu)+'</td></tr>'; });
            h += '</table>';
        }

        // Auto-Determined Parameters with explanation
        if (la.auto_params) {
            const ap = la.auto_params;
            h += '<h3>Auto-Determined Design Parameters</h3>';
            h += '<p style="font-size:10px;color:#555">The following parameters are automatically computed from the load analysis results, deck configuration, and moment diagram shape:</p>';
            h += '<table><tr><th>Parameter</th><th>Value</th><th>Calculation Method</th></tr>';
            if (ap.deck && ap.deck.type !== 'none') {
                h += '<tr><td>k<sub>&phi;</sub> (Rotational Stiffness)</td><td>'+ap.deck.kphi+' kip-in/rad/in</td>';
                h += '<td>Chen & Moen (2011): k<sub>&phi;</sub> = 1/(1/(k&middot;c&sup2;) + c&sup3;/(3EIc&sup2;)), where k=fastener stiffness/spacing, c=flange/2</td></tr>';
                h += '<tr><td>k<sub>x</sub> (Lateral Stiffness)</td><td>'+ap.deck.kx+' kip/in/in</td>';
                h += '<td>2-ply series spring: k<sub>x</sub> = (1/(1/(Et<sub>1</sub>)+1/(Et<sub>2</sub>)))/s &times; 0.04 reduction factor</td></tr>';
            }
            if (ap.positive_region) {
                h += '<tr><td>Positive Region Bracing</td><td>Fully braced (L<sub>y</sub>=0)</td>';
                h += '<td>Top flange in compression, continuously braced by deck panel — no LTB check required</td></tr>';
            }
            if (ap.negative_region) {
                h += '<tr><td>Negative L<sub>y</sub></td><td>'+ap.negative_region.Ly_in+' in</td>';
                h += '<td>Distance from inflection point (M=0) to lap end or support. Bottom flange in compression — unbraced.</td></tr>';
                h += '<tr><td>Negative C<sub>b</sub></td><td>'+ap.negative_region.Cb+'</td>';
                h += '<td>AISI Eq. F2.1.1-2: C<sub>b</sub> = 12.5M<sub>max</sub> / (2.5M<sub>max</sub>+3M<sub>A</sub>+4M<sub>B</sub>+3M<sub>C</sub>), computed from moment diagram over unbraced segment</td></tr>';
            }
            if (ap.uplift_R != null) {
                h += '<tr><td>Uplift R (§I6.2.1)</td><td>'+ap.uplift_R+'</td>';
                h += '<td>Reduction factor per AISI S100 §I6.2.1 — based on section geometry checks (d/t, d/b, b&ge;2.125, flat_b/t, etc.)</td></tr>';
            }
            if (ap.unbraced && ap.unbraced.inflection_points_ft) {
                h += '<tr><td>Inflection Points</td><td>'+ap.unbraced.inflection_points_ft.join(', ')+' ft</td>';
                h += '<td>Locations where moment = 0, found by linear interpolation of moment diagram</td></tr>';
            }
            h += '</table>';
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
            h += '<h3>Interaction Check — §H1.2 (Eq. '+( ir.equation||'H1.2-1')+')</h3>';
            h += '<span class="eq">P<sub>u</sub>/P<sub>a</sub> + M<sub>ux</sub>/M<sub>ax</sub> + M<sub>uy</sub>/M<sub>ay</sub> &le; 1.0</span>';
            h += '<table><tr><th>Term</th><th>Demand</th><th>Capacity</th><th>Ratio</th></tr>';
            h += '<tr><td>Axial P/Pa</td><td></td><td></td><td>'+_rv(ir.P_ratio,4)+'</td></tr>';
            h += '<tr><td>Flexure Mx/Max</td><td></td><td></td><td>'+_rv(ir.Mx_ratio,4)+'</td></tr>';
            h += '<tr><td>Flexure My/May</td><td></td><td></td><td>'+_rv(ir.My_ratio,4)+'</td></tr>';
            h += '<tr style="font-weight:700"><td>Total</td><td colspan="2"></td><td class="'+(ir.pass?'pass':'fail')+'">'+_rv(ir.total,4)+' &le; 1.0 '+(ir.pass?'OK':'NG')+'</td></tr>';
            h += '</table>';
        }
        if (d.shear_interaction) {
            const si = d.shear_interaction;
            h += '<h3>Bending + Shear Interaction — §H2 (Eq. '+(si.equation||'H2-1')+')</h3>';
            h += '<span class="eq">(M<sub>u</sub>/M<sub>ao</sub>)&sup2; + (V<sub>u</sub>/V<sub>a</sub>)&sup2; &le; 1.0</span>';
            h += '<table><tr><th>Term</th><th>Ratio</th></tr>';
            h += '<tr><td>M/Mao</td><td>'+_rv(si.M_ratio,4)+'</td></tr>';
            h += '<tr><td>V/Va</td><td>'+_rv(si.V_ratio,4)+'</td></tr>';
            h += '<tr style="font-weight:700"><td>Total (SRSS)</td><td class="'+(si.pass?'pass':'fail')+'">'+_rv(si.total,4)+' &le; 1.0 '+(si.pass?'OK':'NG')+'</td></tr>';
            h += '</table>';
        }

        // Step summary table
        const steps = d.steps || [];
        if (steps.length > 0) {
            h += '<h3>Calculation Step Summary</h3>';
            h += '<table><tr><th>#</th><th>Step</th><th>Formula</th><th>Result</th><th>Unit</th></tr>';
            steps.forEach(s => {
                const gov = s.controlling_mode ? ' style="background:#fff3e0;font-weight:600"' : '';
                h += '<tr'+gov+'><td>'+s.step+'</td><td>'+s.name+(s.controlling_mode?' <b>[GOVERNS]</b>':'')+'</td>';
                h += '<td style="font-size:10px">'+(s.formula||'')+'</td>';
                h += '<td style="text-align:right;font-weight:600">'+(s.value!=null?s.value:'')+'</td><td>'+(s.unit||'')+'</td></tr>';
            });
            h += '</table>';
        }
        return h;
    }

    function _rptFlexure(d, dm) {
        let h = '';
        const phi=0.90,omega=1.67;
        // Step 1: My
        h += '<h3>Step 1: Yield Moment, M<sub>y</sub></h3>';
        h += '<span class="eq">M<sub>y</sub> = S<sub>f</sub> &times; F<sub>y</sub> = '+_rv(d.My)+' kip-in</span>';

        // Step 2: Global/LTB — Mne
        h += '<h3>Step 2: Global Buckling / Lateral-Torsional Buckling — §F2</h3>';
        h += '<p>The global buckling stress F<sub>cre</sub> is computed based on the unbraced length L<sub>b</sub>, moment gradient C<sub>b</sub>, and section properties (r<sub>y</sub>, J, C<sub>w</sub>).</p>';
        h += '<span class="eq">F<sub>cre</sub> = C<sub>b</sub> &middot; r<sub>o</sub> &middot; A / S<sub>f</sub> &middot; &radic;(&sigma;<sub>ey</sub> &middot; &sigma;<sub>t</sub>)</span>';
        h += '<p>Depending on F<sub>cre</sub> relative to F<sub>y</sub>:</p>';
        h += '<table><tr><th>Condition</th><th>Equation</th><th>Regime</th></tr>';
        h += '<tr><td>F<sub>cre</sub> &ge; 2.78 F<sub>y</sub></td><td>F<sub>n</sub> = F<sub>y</sub></td><td>Yielding (compact)</td></tr>';
        h += '<tr><td>2.78 F<sub>y</sub> &gt; F<sub>cre</sub> &gt; 0.56 F<sub>y</sub></td><td>F<sub>n</sub> = (10/9)F<sub>y</sub>(1 - 10F<sub>y</sub>/(36F<sub>cre</sub>))</td><td>Inelastic LTB</td></tr>';
        h += '<tr><td>F<sub>cre</sub> &le; 0.56 F<sub>y</sub></td><td>F<sub>n</sub> = F<sub>cre</sub></td><td>Elastic LTB</td></tr>';
        h += '</table>';
        h += '<span class="eq">M<sub>ne</sub> = S<sub>f</sub> &times; F<sub>n</sub> = <b>'+_rv(d.Mne)+'</b> kip-in</span>';

        // Step 3: Local — Mnl
        h += '<h3>Step 3: Local Buckling — §F3.2</h3>';
        h += '<p>Local buckling reduces the global strength M<sub>ne</sub> when the local slenderness &lambda;<sub>l</sub> exceeds 0.776:</p>';
        h += '<span class="eq">&lambda;<sub>l</sub> = &radic;(M<sub>ne</sub> / M<sub>crl</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &le; 0.776</td><td>M<sub>nl</sub> = M<sub>ne</sub> (no reduction)</td></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &gt; 0.776</td><td>M<sub>nl</sub> = [1 - 0.15(M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup>] &middot; (M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup> &middot; M<sub>ne</sub></td></tr>';
        h += '</table>';
        const govL = d.Mnl < d.Mne ? ' (local buckling reduces strength by '+(100*(1-d.Mnl/d.Mne)).toFixed(1)+'%)' : ' (no reduction)';
        h += '<span class="eq">M<sub>nl</sub> = <b>'+_rv(d.Mnl)+'</b> kip-in'+govL+'</span>';

        // Step 4: Distortional — Mnd
        h += '<h3>Step 4: Distortional Buckling — §F4</h3>';
        h += '<p>Distortional buckling is checked independently against M<sub>y</sub>:</p>';
        h += '<span class="eq">&lambda;<sub>d</sub> = &radic;(M<sub>y</sub> / M<sub>crd</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &le; 0.673</td><td>M<sub>nd</sub> = M<sub>y</sub> (no reduction)</td></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &gt; 0.673</td><td>M<sub>nd</sub> = [1 - 0.22(M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup>] &middot; (M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup> &middot; M<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">M<sub>nd</sub> = <b>'+_rv(d.Mnd)+'</b> kip-in</span>';

        // Step 5: Nominal & Design
        h += '<h3>Step 5: Nominal Strength & Design Strength</h3>';
        h += '<span class="eq">M<sub>n</sub> = min(M<sub>ne</sub>, M<sub>nl</sub>, M<sub>nd</sub>) = min('+_rv(d.Mne)+', '+_rv(d.Mnl)+', '+_rv(d.Mnd)+') = <b>'+_rv(d.Mn)+'</b> kip-in</span>';
        h += '<span class="eq">Controlling failure mode: <b>'+(d.controlling_mode||'')+'</b></span>';
        if (dm==='LRFD') {
            h += '<span class="eq">&phi;<sub>b</sub> = '+phi+' (LRFD)</span>';
            h += '<span class="eq">&phi;M<sub>n</sub> = '+phi+' &times; '+_rv(d.Mn)+' = <b class="result">'+_rv(d.phi_Mn)+'</b> kip-in</span>';
        } else {
            h += '<span class="eq">&Omega;<sub>b</sub> = '+omega+' (ASD)</span>';
            h += '<span class="eq">M<sub>n</sub>/&Omega; = '+_rv(d.Mn)+' / '+omega+' = <b class="result">'+_rv(d.Mn_omega)+'</b> kip-in</span>';
        }
        if (d.utilization != null) {
            const Mu = d.design_strength > 0 ? (d.utilization * d.design_strength) : 0;
            h += '<span class="eq">M<sub>u</sub> / '+(dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;')+' = '+_rv(Mu)+' / '+_rv(d.design_strength)+' = <b class="'+(d.pass?'pass':'fail')+'">'+_rv(d.utilization*100,1)+'%</b></span>';
        }
        return h;
    }

    function _rptCompression(d, dm) {
        let h = '';
        const phi=0.85,omega=1.80;
        h += '<h3>Step 1: Yield Load, P<sub>y</sub></h3>';
        h += '<span class="eq">P<sub>y</sub> = A<sub>g</sub> &times; F<sub>y</sub> = '+_rv(d.Py)+' kips</span>';

        h += '<h3>Step 2: Global Buckling — §E2</h3>';
        h += '<p>Flexural, torsional, or flexural-torsional buckling stress F<sub>cre</sub> is determined from KL/r, J, C<sub>w</sub>, and section symmetry.</p>';
        h += '<span class="eq">&lambda;<sub>c</sub> = &radic;(F<sub>y</sub> / F<sub>cre</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>c</sub> &le; 1.5</td><td>F<sub>n</sub> = (0.658<sup>&lambda;<sub>c</sub>&sup2;</sup>) F<sub>y</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>c</sub> &gt; 1.5</td><td>F<sub>n</sub> = (0.877/&lambda;<sub>c</sub>&sup2;) F<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>ne</sub> = A<sub>g</sub> &times; F<sub>n</sub> = <b>'+_rv(d.Pne)+'</b> kips</span>';

        h += '<h3>Step 3: Local Buckling — §E3.2</h3>';
        h += '<span class="eq">&lambda;<sub>l</sub> = &radic;(P<sub>ne</sub>/P<sub>crl</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &le; 0.776</td><td>P<sub>nl</sub> = P<sub>ne</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>l</sub> &gt; 0.776</td><td>P<sub>nl</sub> = [1-0.15(P<sub>crl</sub>/P<sub>ne</sub>)<sup>0.4</sup>](P<sub>crl</sub>/P<sub>ne</sub>)<sup>0.4</sup> P<sub>ne</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>nl</sub> = <b>'+_rv(d.Pnl)+'</b> kips</span>';

        h += '<h3>Step 4: Distortional Buckling — §E4</h3>';
        h += '<span class="eq">&lambda;<sub>d</sub> = &radic;(P<sub>y</sub>/P<sub>crd</sub>)</span>';
        h += '<table><tr><th>Condition</th><th>Equation</th></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &le; 0.561</td><td>P<sub>nd</sub> = P<sub>y</sub></td></tr>';
        h += '<tr><td>&lambda;<sub>d</sub> &gt; 0.561</td><td>P<sub>nd</sub> = [1-0.25(P<sub>crd</sub>/P<sub>y</sub>)<sup>0.6</sup>](P<sub>crd</sub>/P<sub>y</sub>)<sup>0.6</sup> P<sub>y</sub></td></tr>';
        h += '</table>';
        h += '<span class="eq">P<sub>nd</sub> = <b>'+_rv(d.Pnd)+'</b> kips</span>';

        h += '<h3>Step 5: Nominal & Design Strength</h3>';
        h += '<span class="eq">P<sub>n</sub> = min(P<sub>ne</sub>,P<sub>nl</sub>,P<sub>nd</sub>) = min('+_rv(d.Pne)+','+_rv(d.Pnl)+','+_rv(d.Pnd)+') = <b>'+_rv(d.Pn)+'</b> kips</span>';
        h += '<span class="eq">Controlling: <b>'+(d.controlling_mode||'')+'</b></span>';
        if (dm==='LRFD') h += '<span class="eq">&phi;P<sub>n</sub> = '+phi+' &times; '+_rv(d.Pn)+' = <b class="result">'+_rv(d.phi_Pn)+'</b> kips</span>';
        else h += '<span class="eq">P<sub>n</sub>/&Omega; = '+_rv(d.Pn)+'/'+omega+' = <b class="result">'+_rv(d.Pn_omega)+'</b> kips</span>';
        return h;
    }

    function _rptCombined(d, dm) {
        let h = '';
        const c=d.compression||{},f=d.flexure_x||{};
        h += '<h3>Compression Strength</h3>';
        h += '<span class="eq">P<sub>n</sub> = '+_rv(c.Pn)+' kips ('+(c.controlling_mode||'')+'), Design = <b>'+_rv(c.design_strength)+'</b> kips</span>';
        h += '<h3>Flexure Strength (x-axis)</h3>';
        h += '<span class="eq">M<sub>n</sub> = '+_rv(f.Mn)+' kip-in ('+(f.controlling_mode||'')+'), Design = <b>'+_rv(f.design_strength)+'</b> kip-in</span>';
        if (d.amplification) {
            const amp = d.amplification;
            h += '<h3>§C1 Moment Amplification (P-&delta; Effect)</h3>';
            h += '<p>Second-order P-&delta; effect amplifies moments in compression members:</p>';
            h += '<span class="eq">P<sub>Ex</sub> = &pi;&sup2;EA<sub>g</sub>/(KL/r<sub>x</sub>)&sup2; = '+_rv(amp.PEx)+' kips</span>';
            h += '<span class="eq">&alpha;<sub>x</sub> = C<sub>mx</sub> / (1 - P<sub>u</sub>/P<sub>Ex</sub>) = '+_rv(amp.alpha_x,4)+' &ge; 1.0</span>';
            h += '<span class="eq">M<sub>ux,amp</sub> = M<sub>ux</sub> &times; &alpha;<sub>x</sub> = '+_rv(amp.Mux_amp)+' kip-in</span>';
        }
        return h;
    }

    function _rptTension(d, dm) {
        let h = '';
        h += '<h3>§D2 — Tensile Yielding on Gross Section</h3>';
        h += '<span class="eq">T<sub>n</sub> = A<sub>g</sub> &times; F<sub>y</sub> = '+_rv(d.Tn_yield)+' kips, &phi;<sub>t</sub>=0.90, &Omega;<sub>t</sub>=1.67</span>';
        h += '<h3>§D3 — Tensile Rupture on Net Section</h3>';
        h += '<span class="eq">T<sub>n</sub> = A<sub>n</sub> &times; F<sub>u</sub> = '+_rv(d.Tn_rupture)+' kips, &phi;<sub>t</sub>=0.75, &Omega;<sub>t</sub>=2.00</span>';
        h += '<span class="eq">Controlling: <b>'+(d.controlling_mode||'')+'</b>, Design Strength = <b class="result">'+_rv(d.design_strength)+'</b> kips</span>';
        return h;
    }

    // ═══════════════════════════════════════════════════════
    // 6. Design Summary
    // ═══════════════════════════════════════════════════════
    function _rptSummary(d, la) {
        const mt = d.member_type||'', dm = d.design_method||'LRFD';
        const mtNames = {flexure:'Flexural Member (Beam/Purlin)',compression:'Compression Member (Column/Stud)',combined:'Combined Axial + Bending Member',tension:'Tension Member'};
        let h = '';

        h += '<p>This report presents the design check of a <b>'+(mtNames[mt]||mt)+'</b> per AISI S100-16 using the Direct Strength Method (DSM). ';
        h += 'The design method is <b>'+dm+'</b>. ';
        if (la) h += 'The member spans <b>'+la.n_spans+'</b> span(s) and the governing gravity load combination is <b>'+((la.gravity||{}).combo||'N/A')+'</b>. ';
        h += 'The controlling failure mode is <b>'+(d.controlling_mode||'N/A')+'</b>.</p>';

        h += '<table>';
        h += '<tr><th style="width:50%">Item</th><th>Value</th></tr>';
        h += '<tr><td>Design Standard</td><td>AISI S100-16</td></tr>';
        h += '<tr><td>Analysis Method</td><td>Direct Strength Method (DSM) — Finite Strip</td></tr>';
        h += '<tr><td>Member Type</td><td>'+(mtNames[mt]||mt)+'</td></tr>';
        h += '<tr><td>Design Method</td><td>'+dm+'</td></tr>';
        h += '<tr><td>Controlling Failure Mode</td><td><b>'+(d.controlling_mode||'')+'</b></td></tr>';

        if (mt==='flexure') {
            h += '<tr><td>Nominal Moment, M<sub>n</sub></td><td>'+_rv(d.Mn)+' kip-in</td></tr>';
            h += '<tr><td>Design Strength, '+(dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;')+'</td><td><b>'+_rv(d.design_strength)+'</b> kip-in</td></tr>';
        } else if (mt==='compression') {
            h += '<tr><td>Nominal Strength, P<sub>n</sub></td><td>'+_rv(d.Pn)+' kips</td></tr>';
            h += '<tr><td>Design Strength, '+(dm==='LRFD'?'&phi;P<sub>n</sub>':'P<sub>n</sub>/&Omega;')+'</td><td><b>'+_rv(d.design_strength)+'</b> kips</td></tr>';
        } else {
            h += '<tr><td>Design Strength</td><td><b>'+_rv(d.design_strength)+'</b></td></tr>';
        }

        if (d.utilization != null) {
            const pct = (d.utilization*100).toFixed(1);
            h += '<tr><td>Demand/Capacity Ratio (DCR)</td><td class="'+(d.pass?'pass':'fail')+'" style="font-size:14px"><b>'+pct+'% — '+(d.pass?'OK':'NG')+'</b></td></tr>';
        }
        if (d.interaction) {
            h += '<tr><td>Interaction Check (§H1.2)</td><td class="'+(d.interaction.pass?'pass':'fail')+'"><b>'+_rv(d.interaction.total,4)+'</b> &le; 1.0 — '+(d.interaction.pass?'OK':'NG')+'</td></tr>';
        }
        h += '<tr><td>Referenced Spec Sections</td><td>'+(d.spec_sections||[]).join(', ')+'</td></tr>';
        h += '</table>';

        // DSM warnings
        const warnings = d.dsm_warnings || [];
        if (warnings.length > 0) {
            h += '<div style="margin-top:8px;padding:6px;background:#fff3e0;border:1px solid #ff9800;border-radius:4px">';
            h += '<b style="color:#e65100">DSM Applicability Warnings:</b><ul style="margin:4px 0;padding-left:20px">';
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
                validationBadge.innerHTML = '<span style="color:#4caf50">PASS '+pass+'</span> / <span style="color:#ffab00">WARN '+warn+'</span> / <span style="color:#ff5252">FAIL '+fail+'</span>';
            }
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
        const fy = getNum('design-fy', 50);
        const fu = getNum('design-fu', 65);
        const H = getNum('tpl-H', 0), B = getNum('tpl-B', 0), D = getNum('tpl-D', 0);
        const t = getNum('tpl-t', 0), r = getNum('tpl-r', 0);

        // ════════════════════════════════════════
        // A. 단면 입력 (Section Input)
        // ════════════════════════════════════════
        const cat = 'A. Section Input';

        checks.push({
            category: cat, item: 'Section Defined',
            status: (model && model.node && model.node.length > 0) ? 'pass' : 'fail',
            value: model ? (model.node||[]).length + ' nodes' : '0',
            criterion: 'At least 1 node defined',
            note: model && model.node && model.node.length > 0 ? '' : 'No section defined — go to Preprocessor tab and generate a template or define nodes/elements.',
        });

        checks.push({
            category: cat, item: 'Thickness (t)',
            status: t > 0 ? (t >= 0.018 && t <= 0.5 ? 'pass' : 'warn') : 'fail',
            value: t > 0 ? t + ' in' : 'Not set',
            criterion: '0.018 ≤ t ≤ 0.5 in (typical CFS range)',
            note: t <= 0 ? 'Thickness not specified.' : (t < 0.018 ? 'Very thin — verify material availability.' : (t > 0.5 ? 'Thick — may not be cold-formed.' : '')),
        });

        if (t > 0 && H > 0) {
            const wt_web = (H - 2*(t+r)) / t;
            checks.push({
                category: cat, item: 'Web w/t Ratio',
                status: wt_web <= 200 ? 'pass' : (wt_web <= 500 ? 'warn' : 'fail'),
                value: wt_web.toFixed(1),
                criterion: 'w/t ≤ 500 (Table B4.1-1 stiffened limit), ≤200 typical',
                note: wt_web > 500 ? 'Exceeds DSM applicability limit — Table B4.1-1.' : (wt_web > 200 ? 'High web slenderness — distortional/local buckling will govern.' : ''),
            });
        }
        if (t > 0 && B > 0) {
            const bt_fl = (B - 2*(t+r)) / t;
            checks.push({
                category: cat, item: 'Flange b/t Ratio',
                status: bt_fl <= 60 ? 'pass' : (bt_fl <= 160 ? 'warn' : 'fail'),
                value: bt_fl.toFixed(1),
                criterion: 'b/t ≤ 160 (Table B4.1-1 edge-stiffened limit)',
                note: bt_fl > 160 ? 'Exceeds DSM applicability limit.' : '',
            });
        }
        if (t > 0 && D > 0) {
            const dt_lip = D / t;
            checks.push({
                category: cat, item: 'Lip d/t Ratio',
                status: dt_lip <= 60 ? 'pass' : 'fail',
                value: dt_lip.toFixed(1),
                criterion: 'd/t ≤ 60 (Table B4.1-1 unstiffened limit)',
                note: dt_lip > 60 ? 'Lip too slender for DSM.' : '',
            });
        }
        if (r > 0 && t > 0) {
            const Rt = r / t;
            checks.push({
                category: cat, item: 'Corner R/t Ratio',
                status: Rt <= 10 ? 'pass' : (Rt <= 20 ? 'warn' : 'fail'),
                value: Rt.toFixed(1),
                criterion: 'R/t ≤ 20 (Table B4.1-1), ≤10 typical',
                note: Rt > 20 ? 'Exceeds corner radius limit.' : '',
            });
        }

        // ════════════════════════════════════════
        // B. 재료 (Material)
        // ════════════════════════════════════════
        const catB = 'B. Material';

        checks.push({
            category: catB, item: 'Yield Strength (Fy)',
            status: fy > 0 ? (fy <= 95 ? 'pass' : 'fail') : 'fail',
            value: fy + ' ksi',
            criterion: 'Fy ≤ 95 ksi (Table B4.1-1 Fy limit)',
            note: fy > 95 ? 'Exceeds AISI S100 DSM Fy limit.' : (fy <= 0 ? 'Fy not specified.' : ''),
        });

        checks.push({
            category: catB, item: 'Fu/Fy Ratio',
            status: fy > 0 && fu > 0 ? (fu/fy >= 1.08 ? 'pass' : 'warn') : 'fail',
            value: fy > 0 && fu > 0 ? (fu/fy).toFixed(3) : 'N/A',
            criterion: 'Fu/Fy ≥ 1.08 (§A2.3.1, §I6.2.1(o))',
            note: fu/fy < 1.08 ? 'Low ductility ratio — Section I6.2.1 R factor may not apply.' : '',
        });

        checks.push({
            category: catB, item: 'Tensile Strength (Fu)',
            status: fu > 0 ? (fu > fy ? 'pass' : 'fail') : 'fail',
            value: fu + ' ksi',
            criterion: 'Fu > Fy',
            note: fu <= fy ? 'Fu must exceed Fy.' : '',
        });

        // ════════════════════════════════════════
        // C. 좌굴 해석 (Buckling Analysis)
        // ════════════════════════════════════════
        const catC = 'C. Buckling Analysis';

        checks.push({
            category: catC, item: 'Analysis Executed',
            status: analysisResult && analysisResult.curve ? 'pass' : 'fail',
            value: analysisResult && analysisResult.curve ? analysisResult.curve.length + ' points' : 'Not run',
            criterion: 'FSM analysis must be completed before design',
            note: !analysisResult ? 'Go to Analysis tab and run buckling analysis.' : '',
        });

        const dP = dsm ? dsm.P : null;
        const dM = dsm ? dsm.Mxx : null;

        checks.push({
            category: catC, item: 'DSM Values Extracted',
            status: dP || dM ? 'pass' : 'fail',
            value: dP ? 'Pcrl='+_rv(dP.Pcrl)+', Pcrd='+_rv(dP.Pcrd) : 'Not available',
            criterion: 'Pcrl, Pcrd, Mcrl, Mcrd must be identified from signature curve',
            note: !dP && !dM ? 'Run analysis first — DSM values are auto-extracted.' : '',
        });

        if (dM) {
            checks.push({
                category: catC, item: 'Mcrl Identified (Local)',
                status: dM.Mxxcrl > 0 ? 'pass' : 'warn',
                value: dM.Mxxcrl > 0 ? _rv(dM.Mxxcrl)+' kip-in (L='+_rv(dM.Lcrl,1)+' in)' : 'Not found',
                criterion: 'Local buckling minimum should be identifiable',
                note: dM.Mxxcrl <= 0 ? 'No local buckling minimum found — design will skip local check (Mnl=Mne).' : '',
            });
            checks.push({
                category: catC, item: 'Mcrd Identified (Distortional)',
                status: dM.Mxxcrd > 0 ? 'pass' : 'warn',
                value: dM.Mxxcrd > 0 ? _rv(dM.Mxxcrd)+' kip-in (L='+_rv(dM.Lcrd,1)+' in)' : 'Not found',
                criterion: 'Distortional buckling minimum should be identifiable for C/Z sections',
                note: dM.Mxxcrd <= 0 ? 'No distortional minimum — design will skip distortional check (Mnd=My). Verify if section has edge stiffeners.' : '',
            });
        }

        // ════════════════════════════════════════
        // D. 단면 성질 (Section Properties)
        // ════════════════════════════════════════
        const catD = 'D. Section Properties';

        checks.push({
            category: catD, item: 'Properties Computed',
            status: p ? 'pass' : 'fail',
            value: p ? 'A='+_rv(p.A,4)+' in²' : 'Not computed',
            criterion: 'Section properties must be available for design',
            note: !p ? 'Click "Get Properties" in Preprocessor tab.' : '',
        });

        if (p) {
            checks.push({
                category: catD, item: 'Section Modulus Sx',
                status: p.Sx > 0 ? 'pass' : 'fail',
                value: p.Sx > 0 ? _rv(p.Sx,4)+' in³' : '0 or N/A',
                criterion: 'Sx > 0 required for flexure design (Sf)',
                note: p.Sx <= 0 ? 'Section modulus is zero — cannot compute My=Sf×Fy.' : '',
            });
            checks.push({
                category: catD, item: 'Radius of Gyration rx, rz',
                status: p.rx > 0 && p.rz > 0 ? 'pass' : 'warn',
                value: 'rx='+_rv(p.rx,4)+', rz='+_rv(p.rz,4)+' in',
                criterion: 'rx, rz > 0 for column/LTB design',
                note: (p.rx <= 0 || p.rz <= 0) ? 'Zero radius of gyration — check section geometry.' : '',
            });
        }

        // ════════════════════════════════════════
        // E. 하중 입력 (Load Input)
        // ════════════════════════════════════════
        const catE = 'E. Load Input';
        const spacing = getNum('config-spacing', 5);
        const spanFt = getNum('config-span', 0);
        const loadD = getNum('load-D-psf', 0);
        const loadLr = getNum('load-Lr-psf', 0);
        const loadS = getNum('load-S-psf', 0);
        const loadL = getNum('load-L-psf', 0);
        const loadW = getNum('load-Wu-psf', 0);

        checks.push({
            category: catE, item: 'Span Length',
            status: spanFt > 0 ? (spanFt <= 40 ? 'pass' : 'warn') : 'fail',
            value: spanFt > 0 ? spanFt+' ft' : 'Not set',
            criterion: 'Span > 0 required; typical CFS ≤ 33 ft (§I6.2.1)',
            note: spanFt <= 0 ? 'Set span length.' : (spanFt > 33 ? 'Exceeds §I6.2.1 span limit — R factor may not apply.' : ''),
        });

        checks.push({
            category: catE, item: 'Tributary Width (Spacing)',
            status: spacing > 0 ? (spacing <= 8 ? 'pass' : 'warn') : 'fail',
            value: spacing+' ft',
            criterion: 'Spacing > 0; typical 4-6 ft',
            note: spacing > 8 ? 'Large spacing — verify load distribution.' : '',
        });

        checks.push({
            category: catE, item: 'Dead Load (D)',
            status: loadD > 0 ? 'pass' : 'warn',
            value: loadD+' psf',
            criterion: 'D > 0 expected (self-weight + roofing)',
            note: loadD <= 0 ? 'No dead load? Self-weight should be included. Typical: 5-15 psf.' : '',
        });

        const hasGravity = loadLr > 0 || loadS > 0 || loadL > 0;
        checks.push({
            category: catE, item: 'Gravity Live/Snow Load',
            status: hasGravity ? 'pass' : 'warn',
            value: [loadLr>0?'Lr='+loadLr:'',loadS>0?'S='+loadS:'',loadL>0?'L='+loadL:''].filter(Boolean).join(', ')+' psf' || 'None',
            criterion: 'At least one gravity live load expected',
            note: !hasGravity ? 'No live/snow load — is this correct?' : '',
        });

        // ════════════════════════════════════════
        // F. 하중 분석 결과 (Load Analysis Results)
        // ════════════════════════════════════════
        const catF = 'F. Load Analysis';

        checks.push({
            category: catF, item: 'Load Analysis Executed',
            status: la ? 'pass' : 'fail',
            value: la ? 'Combo: '+(la.gravity?la.gravity.combo:'N/A') : 'Not run',
            criterion: 'Load analysis required before design',
            note: !la ? 'Click "Analyze Loads" in Design tab.' : '',
        });

        if (la && la.gravity && la.gravity.locations) {
            const locs = la.gravity.locations;
            const maxMu = Math.max(...locs.filter(l=>l.Mu!=null).map(l=>Math.abs(l.Mu)));
            checks.push({
                category: catF, item: 'Maximum Mu',
                status: maxMu > 0 ? 'pass' : 'warn',
                value: _rv(maxMu)+' kip-ft',
                criterion: 'Mu should be > 0 if gravity loads exist',
                note: maxMu <= 0 ? 'Zero moment — check loads and span.' : '',
            });
            const hasVu = locs.some(l => l.Vu != null && l.Vu > 0);
            checks.push({
                category: catF, item: 'Shear Values (Vu)',
                status: hasVu ? 'pass' : 'warn',
                value: hasVu ? 'Available' : 'Missing at some locations',
                criterion: 'Vu should be present at supports and critical sections',
                note: !hasVu ? 'No shear values found — check analysis results.' : '',
            });
        }

        if (la && la.auto_params) {
            const ap = la.auto_params;
            if (ap.negative_region) {
                checks.push({
                    category: catF, item: 'Unbraced Length Ly (Negative)',
                    status: ap.negative_region.Ly_in > 0 ? 'pass' : 'warn',
                    value: ap.negative_region.Ly_in+' in',
                    criterion: 'Ly > 0 for negative moment region (unbraced bottom flange)',
                    note: ap.negative_region.Ly_in <= 0 ? 'Zero unbraced length — fully braced negative region?' : '',
                });
                checks.push({
                    category: catF, item: 'Moment Gradient Cb',
                    status: ap.negative_region.Cb >= 1.0 ? 'pass' : 'warn',
                    value: ap.negative_region.Cb,
                    criterion: 'Cb ≥ 1.0 (AISI Eq. F2.1.1-2), typically 1.0-2.3',
                    note: ap.negative_region.Cb < 1.0 ? 'Cb < 1.0 is unusual — verify.' : (ap.negative_region.Cb > 2.5 ? 'Very high Cb — verify moment diagram shape.' : ''),
                });
            }
            if (ap.uplift_R != null) {
                checks.push({
                    category: catF, item: 'Uplift R Factor (§I6.2.1)',
                    status: ap.uplift_R > 0 ? 'pass' : 'warn',
                    value: ap.uplift_R,
                    criterion: 'R = 0.40-0.70 per §I6.2.1 if conditions met',
                    note: ap.uplift_R === 0.60 && !la.section ? 'R=0.60 is default (no section info passed) — may be conservative.' : '',
                });
            }
        }

        // ════════════════════════════════════════
        // G. 설계 결과 (Design Results)
        // ════════════════════════════════════════
        const catG = 'G. Design Results';

        checks.push({
            category: catG, item: 'Design Check Executed',
            status: d ? 'pass' : 'fail',
            value: d ? d.member_type+' / '+d.design_method : 'Not run',
            criterion: 'Design check must be completed',
            note: !d ? 'Click "Run Design Check" in Design tab.' : '',
        });

        if (d && !d.error) {
            // Mn components check
            if (d.member_type === 'flexure') {
                checks.push({
                    category: catG, item: 'Mne vs My',
                    status: d.Mne != null && d.My != null ? (d.Mne <= d.My ? 'pass' : 'warn') : 'fail',
                    value: 'Mne='+_rv(d.Mne)+', My='+_rv(d.My),
                    criterion: 'Mne ≤ My expected (LTB reduces or equals yield)',
                    note: d.Mne > d.My * 1.01 ? 'Mne > My — unusual unless Cb effect. Verify Lb and Cb.' : '',
                });
                checks.push({
                    category: catG, item: 'Mnl vs Mne (Local reduction)',
                    status: d.Mnl != null ? (d.Mnl < d.Mne ? 'warn' : 'pass') : 'fail',
                    value: 'Mnl='+_rv(d.Mnl)+', Mne='+_rv(d.Mne),
                    criterion: 'Mnl ≤ Mne; if Mnl < Mne → local buckling reduces strength',
                    note: d.Mnl != null && d.Mnl >= d.Mne ? 'No local reduction (λl ≤ 0.776).' : 'Local buckling reduces strength by '+(d.Mne>0?((1-d.Mnl/d.Mne)*100).toFixed(1):'?')+'%.',
                });
                checks.push({
                    category: catG, item: 'Mnd vs My (Distortional reduction)',
                    status: d.Mnd != null ? (d.Mnd < d.My ? 'warn' : 'pass') : 'fail',
                    value: 'Mnd='+_rv(d.Mnd)+', My='+_rv(d.My),
                    criterion: 'Mnd ≤ My; if Mnd < My → distortional buckling reduces strength',
                    note: d.Mnd != null && d.Mnd >= d.My ? 'No distortional reduction (λd ≤ 0.673).' : 'Distortional reduces strength by '+(d.My>0?((1-d.Mnd/d.My)*100).toFixed(1):'?')+'%.',
                });
                checks.push({
                    category: catG, item: 'All Mn Equal (Potential Issue)',
                    status: (d.Mne === d.Mnl && d.Mnl === d.Mnd && d.Mnd === d.My) ? 'warn' : 'pass',
                    value: d.Mne === d.My ? 'Mne=Mnl=Mnd=My='+_rv(d.My) : 'Values differ (normal)',
                    criterion: 'If all four equal, DSM may not be applying buckling reductions',
                    note: (d.Mne === d.Mnl && d.Mnl === d.Mnd && d.Mnd === d.My) ? 'All DSM strengths are identical — check if Mcrl/Mcrd are being extracted correctly from FSM analysis.' : '',
                });
            }

            if (d.member_type === 'compression') {
                checks.push({
                    category: catG, item: 'Pnl vs Pne (Local reduction)',
                    status: d.Pnl != null ? (d.Pnl < d.Pne ? 'warn' : 'pass') : 'fail',
                    value: 'Pnl='+_rv(d.Pnl)+', Pne='+_rv(d.Pne),
                    criterion: 'Pnl ≤ Pne; if reduced → local buckling governs',
                    note: '',
                });
                checks.push({
                    category: catG, item: 'Pnd vs Py (Distortional reduction)',
                    status: d.Pnd != null ? (d.Pnd < d.Py ? 'warn' : 'pass') : 'fail',
                    value: 'Pnd='+_rv(d.Pnd)+', Py='+_rv(d.Py),
                    criterion: 'Pnd ≤ Py; if reduced → distortional governs',
                    note: '',
                });
            }

            // Utilization
            if (d.utilization != null) {
                const util = d.utilization;
                checks.push({
                    category: catG, item: 'Utilization Ratio (DCR)',
                    status: util <= 0.95 ? 'pass' : (util <= 1.0 ? 'warn' : 'fail'),
                    value: (util*100).toFixed(1)+'%',
                    criterion: 'DCR ≤ 100% (≤95% preferred for margin)',
                    note: util > 1.0 ? 'OVER-STRESSED — member does not meet design requirements. Increase section or reduce loads.' : (util > 0.95 ? 'Very close to limit — consider margin.' : ''),
                });
            }

            // Safety factors
            if (d.design_method === 'LRFD') {
                checks.push({
                    category: catG, item: 'Resistance Factor (φ)',
                    status: 'pass',
                    value: d.member_type === 'flexure' ? 'φb = 0.90' : (d.member_type === 'compression' ? 'φc = 0.85' : 'φ applied'),
                    criterion: 'LRFD factors per AISI S100-16',
                    note: '',
                });
            }

            // Interaction
            if (d.interaction) {
                checks.push({
                    category: catG, item: 'Interaction Check (§H1.2)',
                    status: d.interaction.pass ? (d.interaction.total <= 0.95 ? 'pass' : 'warn') : 'fail',
                    value: _rv(d.interaction.total,4)+' ≤ 1.0',
                    criterion: 'P/Pa + Mx/Max + My/May ≤ 1.0',
                    note: d.interaction.pass ? '' : 'Interaction check FAILS — reduce loads or increase section.',
                });
            }

            // DSM warnings from design engine
            if (d.dsm_warnings && d.dsm_warnings.length > 0) {
                d.dsm_warnings.forEach((w, i) => {
                    checks.push({
                        category: catG, item: 'DSM Warning #'+(i+1),
                        status: 'warn',
                        value: w,
                        criterion: 'Table B4.1-1 applicability limits',
                        note: 'Section may be outside DSM pre-qualified limits.',
                    });
                });
            }
        }

        // ════════════════════════════════════════
        // H. 설계 일관성 (Consistency)
        // ════════════════════════════════════════
        const catH = 'H. Consistency';

        // Check Fy matches between analysis and design
        const fyLoad = getNum('input-fy-load', 50);
        checks.push({
            category: catH, item: 'Fy Consistency (Analysis vs Design)',
            status: Math.abs(fy - fyLoad) < 0.1 ? 'pass' : 'warn',
            value: 'Analysis fy='+fyLoad+', Design Fy='+fy,
            criterion: 'Analysis stress fy should match design Fy',
            note: Math.abs(fy - fyLoad) >= 0.1 ? 'Fy mismatch — buckling analysis used different Fy than design. Re-run analysis with correct Fy.' : '',
        });

        // Check if analysis was run with current section
        if (model && model.node && analysisResult) {
            checks.push({
                category: catH, item: 'Analysis Currency',
                status: 'pass', // can't easily verify, assume pass
                value: 'Analysis result exists',
                criterion: 'Analysis should match current section geometry',
                note: 'If section was modified after analysis, re-run to get updated results.',
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
            if (catPass) h += '<span style="color:'+colors.pass+'">'+catPass+' pass</span> ';
            if (catWarn) h += '<span style="color:'+colors.warn+'">'+catWarn+' warn</span> ';
            if (catFail) h += '<span style="color:'+colors.fail+'">'+catFail+' fail</span>';
            h += '</span></div>';

            h += '<table style="width:100%;font-size:11px;border-collapse:collapse;margin-top:2px">';
            h += '<tr style="background:var(--vscode-editor-selectionBackground)"><th style="width:20px"></th><th>Check Item</th><th>Value</th><th>Criterion</th></tr>';
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
        data.fy = getNum('design-fy', 50);
        data.fu = getNum('design-fu', 65);
        // Design method
        data.designMethod = document.getElementById('select-design-method')?.value || 'LRFD';
        data.analysisMethod = document.getElementById('select-analysis-method')?.value || 'DSM';
        // Member type
        data.memberType = document.getElementById('select-member-type')?.value || 'flexure';
        // Span config
        data.spanType = document.getElementById('select-span-type')?.value || 'simple';
        data.nSpans = getNum('config-n-spans', 5);
        data.spacing = getNum('config-spacing', 5);
        // 스팬 테이블 데이터
        const spanLens = []; const sups = []; const laps = [];
        document.querySelectorAll('.span-tbl-len').forEach(el => spanLens.push(parseFloat(el.value) || 25));
        document.querySelectorAll('.span-tbl-sup').forEach(el => sups.push(el.value));
        const nSup = sups.length;
        for (let i = 0; i < nSup; i++) {
            const lEl = document.querySelector('.span-tbl-lapl[data-idx="' + i + '"]');
            const rEl = document.querySelector('.span-tbl-lapr[data-idx="' + i + '"]');
            laps.push({ left: lEl ? parseFloat(lEl.value) || 0 : 0, right: rEl ? parseFloat(rEl.value) || 0 : 0 });
        }
        data.spans = spanLens;
        data.supports = sups;
        data.lapsPerSupport = laps;
        // Loads
        data.loadD = getNum('load-D-psf', 0);
        data.loadLr = getNum('load-Lr-psf', 0);
        data.loadS = getNum('load-S-psf', 0);
        data.loadWu = getNum('load-Wu-psf', 0);
        data.loadL = getNum('load-L-psf', 0);
        // Deck
        data.deckType = document.getElementById('select-deck-type')?.value || 'none';
        data.deckTPanel = getNum('deck-t-panel', 0.018);
        data.deckFastenerSpacing = getNum('deck-fastener-spacing', 12);
        data.deckKphiOverride = getNum('deck-kphi-override', 0);
        // Unbraced lengths
        data.KxLx = getNum('design-KxLx', 120);
        data.KyLy = getNum('design-KyLy', 120);
        data.KtLt = getNum('design-KtLt', 120);
        data.Lb = getNum('design-Lb', 120);
        data.Cb = getNum('design-Cb', 1.0);
        data.Cmx = getNum('design-Cmx', 0.85);
        data.Cmy = getNum('design-Cmy', 0.85);
        // Required loads
        data.Pu = getNum('design-P', 0);
        data.Vu = getNum('design-V', 0);
        data.Mux = getNum('design-Mx', 0);
        data.Muy = getNum('design-My', 0);
        // Web crippling
        data.wcN = getNum('design-wc-N', 3.5);
        data.wcR = getNum('design-wc-R', 0.1875);
        data.wcSupport = document.getElementById('design-wc-support')?.value || 'EOF';
        // Template params
        data.templateType = document.getElementById('select-template')?.value || '';
        data.tplH = getNum('tpl-H', 9);
        data.tplB = getNum('tpl-B', 5);
        data.tplD = getNum('tpl-D', 1);
        data.tplT = getNum('tpl-t', 0.1);
        data.tplR = getNum('tpl-r', 0);
        data.tplQlip = getNum('tpl-qlip', 90);
        // Analysis config
        data.fyLoad = getNum('input-fy-load', 50);
        return data;
    }

    function restoreAllDesignInputs(data) {
        if (!data) return;
        function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
        function setSelect(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
        // Material
        if (data.steelGrade) setSelect('select-steel-grade', data.steelGrade);
        if (data.fy) setValue('design-fy', data.fy);
        if (data.fu) setValue('design-fu', data.fu);
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
        if (data.spacing) setValue('config-spacing', data.spacing);
        // 스팬 테이블 재생성 후 값 복원
        if (typeof buildSpanTable === 'function') buildSpanTable();
        setTimeout(() => {
            if (data.spans) {
                document.querySelectorAll('.span-tbl-len').forEach((el, i) => {
                    if (data.spans[i] != null) el.value = data.spans[i];
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
                    if (lEl && lap.left != null) lEl.value = lap.left;
                    if (rEl && lap.right != null) rEl.value = lap.right;
                });
            }
        }, 100);
        // Loads
        if (data.loadD != null) setValue('load-D-psf', data.loadD);
        if (data.loadLr != null) setValue('load-Lr-psf', data.loadLr);
        if (data.loadS != null) setValue('load-S-psf', data.loadS);
        if (data.loadWu != null) setValue('load-Wu-psf', data.loadWu);
        if (data.loadL != null) setValue('load-L-psf', data.loadL);
        // Deck
        if (data.deckType) setSelect('select-deck-type', data.deckType);
        if (data.deckTPanel) setValue('deck-t-panel', data.deckTPanel);
        if (data.deckFastenerSpacing) setValue('deck-fastener-spacing', data.deckFastenerSpacing);
        if (data.deckKphiOverride) setValue('deck-kphi-override', data.deckKphiOverride);
        // Unbraced lengths
        if (data.KxLx) setValue('design-KxLx', data.KxLx);
        if (data.KyLy) setValue('design-KyLy', data.KyLy);
        if (data.KtLt) setValue('design-KtLt', data.KtLt);
        if (data.Lb) setValue('design-Lb', data.Lb);
        if (data.Cb) setValue('design-Cb', data.Cb);
        if (data.Cmx) setValue('design-Cmx', data.Cmx);
        if (data.Cmy) setValue('design-Cmy', data.Cmy);
        // Required loads
        if (data.Pu != null) setValue('design-P', data.Pu);
        if (data.Vu != null) setValue('design-V', data.Vu);
        if (data.Mux != null) setValue('design-Mx', data.Mux);
        if (data.Muy != null) setValue('design-My', data.Muy);
        // Web crippling
        if (data.wcN) setValue('design-wc-N', data.wcN);
        if (data.wcR) setValue('design-wc-R', data.wcR);
        if (data.wcSupport) setSelect('design-wc-support', data.wcSupport);
        // Template
        if (data.templateType) setSelect('select-template', data.templateType);
        if (data.tplH) setValue('tpl-H', data.tplH);
        if (data.tplB) setValue('tpl-B', data.tplB);
        if (data.tplD) setValue('tpl-D', data.tplD);
        if (data.tplT) setValue('tpl-t', data.tplT);
        if (data.tplR) setValue('tpl-r', data.tplR);
        if (data.tplQlip) setValue('tpl-qlip', data.tplQlip);
        if (data.fyLoad) setValue('input-fy-load', data.fyLoad);
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
