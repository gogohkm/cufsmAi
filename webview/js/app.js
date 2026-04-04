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
        // Babylon.js 3D 우선 시도
        if (window.CufsmViewer3D && window.CufsmViewer3D.renderPlastic) {
            try {
                window.CufsmViewer3D.renderPlastic(data);
                return;
            } catch (e) {
                console.warn('Babylon.js plastic surface failed:', e);
            }
        }

        // Canvas 2D — P-Mxx 소성 상호작용 다이어그램
        const canvas = document.getElementById('plastic-surface-canvas');
        if (!canvas || !data || !data.P) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const w = canvas.width, h = canvas.height;
        const pad = { top: 30, right: 30, bottom: 50, left: 70 };

        ctx.clearRect(0, 0, w, h);
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
        const gridColor = style.getPropertyValue('--vscode-panel-border').trim() || '#333';

        const P = data.P, Mxx = data.Mxx;

        // 핵심 수치 추출
        const Py_pos = Math.max(...P);           // 인장 항복 축력
        const Py_neg = Math.min(...P);           // 압축 항복 축력
        const My_pos = Math.max(...Mxx);         // 양 항복 모멘트
        const My_neg = Math.min(...Mxx);         // 음 항복 모멘트
        const pMax = Math.max(Math.abs(Py_pos), Math.abs(Py_neg)) * 1.1 || 1;
        const mMax = Math.max(Math.abs(My_pos), Math.abs(My_neg)) * 1.1 || 1;

        const plotL = pad.left, plotR = w - pad.right;
        const plotT = pad.top, plotB = h - pad.bottom;
        const toX = (m) => plotL + (m / mMax + 1) / 2 * (plotR - plotL);
        const toY = (p) => plotB - (p / pMax + 1) / 2 * (plotB - plotT);

        // --- 그리드 ---
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        // 수직/수평 중심선
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(toX(0), plotT); ctx.lineTo(toX(0), plotB); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(plotL, toY(0)); ctx.lineTo(plotR, toY(0)); ctx.stroke();
        ctx.setLineDash([]);

        // --- Convex Hull로 깨끗한 외곽 면 ---
        const allPts = [];
        for (let i = 0; i < P.length; i++) {
            allPts.push([Mxx[i], P[i]]);
        }
        const hull = _convexHull(allPts);

        if (hull.length > 2) {
            // 면 채움 (그라디언트)
            const grad = ctx.createRadialGradient(toX(0), toY(0), 0, toX(0), toY(0), (plotR - plotL) * 0.6);
            grad.addColorStop(0, 'rgba(79,195,247,0.25)');
            grad.addColorStop(1, 'rgba(79,195,247,0.05)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            hull.forEach((pt, i) => {
                const px = toX(pt[0]), py = toY(pt[1]);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.fill();

            // 외곽선
            ctx.strokeStyle = '#4fc3f7';
            ctx.lineWidth = 2;
            ctx.beginPath();
            hull.forEach((pt, i) => {
                const px = toX(pt[0]), py = toY(pt[1]);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.closePath();
            ctx.stroke();
        }

        // --- 핵심 점 마커 + 수치 ---
        const keyPoints = [
            { m: 0,      p: Py_pos,  label: `Py = ${Py_pos.toFixed(1)}`,  align: 'left',  dx: 8,  dy: -8,  color: '#ff5722' },
            { m: 0,      p: Py_neg,  label: `Py = ${Py_neg.toFixed(1)}`,  align: 'left',  dx: 8,  dy: 14,  color: '#ff5722' },
            { m: My_pos, p: 0,       label: `My = ${My_pos.toFixed(1)}`,  align: 'left',  dx: 6,  dy: -8,  color: '#ffab00' },
            { m: My_neg, p: 0,       label: `My = ${My_neg.toFixed(1)}`,  align: 'right', dx: -6, dy: -8,  color: '#ffab00' },
        ];

        keyPoints.forEach(kp => {
            const px = toX(kp.m), py = toY(kp.p);
            // 마커
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, 2 * Math.PI);
            ctx.fillStyle = kp.color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // 라벨
            ctx.font = 'bold 11px sans-serif';
            ctx.fillStyle = kp.color;
            ctx.textAlign = kp.align;
            ctx.fillText(kp.label, px + kp.dx, py + kp.dy);
        });

        // --- 축 라벨 ---
        ctx.fillStyle = fg;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mxx (kip-in)', w / 2, h - 5);
        ctx.save();
        ctx.translate(14, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('P (kips)', 0, 0);
        ctx.restore();

        // --- 축 눈금 ---
        ctx.font = '10px sans-serif';
        ctx.fillStyle = fg;
        // X축
        ctx.textAlign = 'center';
        const mStep = _niceStep(mMax * 2, 6);
        for (let mv = -Math.floor(mMax / mStep) * mStep; mv <= mMax; mv += mStep) {
            if (Math.abs(mv) < mStep * 0.01) { continue; }
            const px = toX(mv);
            if (px < plotL + 10 || px > plotR - 10) { continue; }
            ctx.fillText(mv.toFixed(0), px, plotB + 16);
            ctx.strokeStyle = gridColor; ctx.lineWidth = 0.3;
            ctx.beginPath(); ctx.moveTo(px, plotT); ctx.lineTo(px, plotB); ctx.stroke();
        }
        // Y축
        ctx.textAlign = 'right';
        const pStep = _niceStep(pMax * 2, 6);
        for (let pv = -Math.floor(pMax / pStep) * pStep; pv <= pMax; pv += pStep) {
            if (Math.abs(pv) < pStep * 0.01) { continue; }
            const py = toY(pv);
            if (py < plotT + 5 || py > plotB - 5) { continue; }
            ctx.fillText(pv.toFixed(1), plotL - 6, py + 4);
            ctx.strokeStyle = gridColor; ctx.lineWidth = 0.3;
            ctx.beginPath(); ctx.moveTo(plotL, py); ctx.lineTo(plotR, py); ctx.stroke();
        }

        // --- 정보 박스 (우상단) ---
        const infoLines = [
            `Py(+) = ${Py_pos.toFixed(2)} kips`,
            `Py(-) = ${Py_neg.toFixed(2)} kips`,
            `My(+) = ${My_pos.toFixed(1)} kip-in`,
            `My(-) = ${My_neg.toFixed(1)} kip-in`,
            `fy = ${data.fy || '?'} ksi`,
        ];
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        const boxW = 170, boxH = infoLines.length * 14 + 8;
        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        ctx.fillRect(plotR - boxW - 4, plotT + 4, boxW, boxH);
        ctx.fillStyle = '#aaa';
        infoLines.forEach((line, i) => {
            ctx.fillText(line, plotR - 10, plotT + 18 + i * 14);
        });
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
    // 초기화
    // ============================================================
    vscode.postMessage({ command: 'webviewReady' });

})();
