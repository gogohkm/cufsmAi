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
                renderDsmResults(msg.data);
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

    // ============================================================
    // 단면 성질 표시
    // ============================================================
    function renderProperties(props) {
        const el = document.getElementById('section-props');
        if (!el) { return; }
        el.innerHTML = `
            A = ${fmt(props.A)}  |  xcg = ${fmt(props.xcg)}  |  zcg = ${fmt(props.zcg)}<br>
            Ixx = ${fmt(props.Ixx)}  |  Izz = ${fmt(props.Izz)}  |  Ixz = ${fmt(props.Ixz)}<br>
            θp = ${fmt(props.thetap)}°  |  I11 = ${fmt(props.I11)}  |  I22 = ${fmt(props.I22)}
        `;
    }

    // ============================================================
    // DSM 설계값 테이블
    // ============================================================
    function renderDsmResults(dsm) {
        const el = document.getElementById('dsm-table-container');
        if (!el || !dsm) { return; }

        const lt = dsm.load_type || 'P';
        const pref = dsm.P_ref || 0;
        const unit_f = lt === 'P' ? '' : '';

        // 항복 하중
        let html = '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<tr style="border-bottom:2px solid var(--vscode-panel-border);">';
        html += '<th style="text-align:left; padding:4px 8px;">Property</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Value</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Half-wavelength</th>';
        html += '<th style="text-align:right; padding:4px 8px;">Load Factor</th>';
        html += '</tr>';

        // Py, My
        html += _dsmRow('Py (yield axial)', dsm.Py, '', '');
        html += _dsmRow('My,xx (yield moment)', dsm.My_xx, '', '');
        html += _dsmRow('My,zz (yield moment)', dsm.My_zz, '', '');

        html += '<tr><td colspan="4" style="border-bottom:1px solid var(--vscode-panel-border);"></td></tr>';

        // 국부 좌굴
        const pcrl_key = lt + 'crl';
        html += _dsmRow(
            lt + 'crl (local buckling)',
            dsm[pcrl_key] || 0,
            dsm.Lcrl ? dsm.Lcrl.toFixed(2) : '-',
            dsm.LF_local ? dsm.LF_local.toFixed(4) : '-'
        );

        // 뒤틀림 좌굴
        const pcrd_key = lt + 'crd';
        html += _dsmRow(
            lt + 'crd (distortional)',
            dsm[pcrd_key] || 0,
            dsm.Lcrd ? dsm.Lcrd.toFixed(2) : '-',
            dsm.LF_dist ? dsm.LF_dist.toFixed(4) : '-'
        );

        // 전체 좌굴
        const pcre_key = lt + 'cre';
        html += _dsmRow(
            lt + 'cre (global)',
            dsm[pcre_key] || 0,
            dsm.Lcre ? dsm.Lcre.toFixed(2) : '-',
            dsm.LF_global ? dsm.LF_global.toFixed(4) : '-'
        );

        html += '</table>';

        // 극소점 정보
        if (dsm.n_minima !== undefined) {
            html += `<div style="margin-top:6px; font-size:11px; color:var(--vscode-descriptionForeground);">`;
            html += `Detected ${dsm.n_minima} minima on signature curve`;
            if (dsm.minima) {
                dsm.minima.forEach((m, i) => {
                    html += ` | Min ${i+1}: L=${m.length.toFixed(1)}, LF=${m.load_factor.toFixed(4)}`;
                });
            }
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function _dsmRow(label, value, length, lf) {
        const v = typeof value === 'number' ? value.toFixed(2) : value;
        return `<tr>
            <td style="padding:3px 8px;">${label}</td>
            <td style="text-align:right; padding:3px 8px; font-weight:600;">${v}</td>
            <td style="text-align:right; padding:3px 8px;">${length}</td>
            <td style="text-align:right; padding:3px 8px;">${lf}</td>
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

        // Canvas 2D 폴백 — P vs Mxx 2D 곡선
        const canvas = document.getElementById('plastic-surface-canvas');
        if (!canvas || !data || !data.P) { return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { return; }
        const w = canvas.width, h = canvas.height;
        const pad = { top: 30, right: 30, bottom: 40, left: 60 };

        ctx.clearRect(0, 0, w, h);
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';

        const P = data.P, Mxx = data.Mxx;
        const pMax = Math.max(...P.map(Math.abs)) || 1;
        const mMax = Math.max(...Mxx.map(Math.abs)) || 1;

        const toX = (m) => pad.left + (m / mMax + 1) / 2 * (w - pad.left - pad.right);
        const toY = (p) => h - pad.bottom - (p / pMax + 1) / 2 * (h - pad.top - pad.bottom);

        ctx.fillStyle = 'rgba(79,195,247,0.15)';
        ctx.beginPath();
        for (let i = 0; i < P.length; i++) {
            const x = toX(Mxx[i]), y = toY(P[i]);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < P.length; i++) {
            const x = toX(Mxx[i]), y = toY(P[i]);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 축 라벨
        ctx.fillStyle = fg;
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Mxx', w / 2, h - 5);
        ctx.save();
        ctx.translate(12, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('P', 0, 0);
        ctx.restore();
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

            vscode.postMessage({ command: 'runAnalysis', data: model });
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

        const toX = (val) => pad.left + (Math.log10(val) - xMin) / (xMax - xMin) * (w - pad.left - pad.right);
        const toY = (val) => h - pad.bottom - ((val - yMin) / (yMax - yMin)) * (h - pad.top - pad.bottom);

        // 클리어
        ctx.clearRect(0, 0, w, h);

        // 배경
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
        const gridColor = style.getPropertyValue('--vscode-panel-border').trim() || '#333';

        // 그리드
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 0.5;
        for (let exp = Math.ceil(xMin); exp <= Math.floor(xMax); exp++) {
            const x = toX(Math.pow(10, exp));
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, h - pad.bottom); ctx.stroke();
        }

        // 다중 모드 곡선 (2nd, 3rd 모드 — 반투명)
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
            ctx.lineWidth = modeIdx === 0 ? 2 : 1;
            ctx.globalAlpha = modeIdx === 0 ? 1.0 : 0.4;
            modePoints.forEach((pt, i) => {
                const px = toX(pt[0]);
                const py = toY(pt[1]);
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.stroke();
        }
        ctx.globalAlpha = 1.0;

        // 최소값 마커
        let minPt = points[0];
        points.forEach(p => { if (p[1] < minPt[1]) { minPt = p; } });
        ctx.beginPath();
        ctx.arc(toX(minPt[0]), toY(minPt[1]), 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ff5722';
        ctx.fill();

        // 축 라벨
        ctx.fillStyle = fg;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Half-wavelength', w / 2, h - 8);
        ctx.save();
        ctx.translate(14, h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Load Factor', 0, 0);
        ctx.restore();

        // 최소값 텍스트
        ctx.fillStyle = '#ff5722';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`min = ${minPt[1].toFixed(4)} @ L=${minPt[0].toFixed(1)}`,
            toX(minPt[0]) + 10, toY(minPt[1]) - 5);

        // X축 눈금
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        for (let exp = Math.ceil(xMin); exp <= Math.floor(xMax); exp++) {
            ctx.fillText(Math.pow(10, exp).toString(), toX(Math.pow(10, exp)), h - pad.bottom + 16);
        }
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
