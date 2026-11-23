/* global module, globalThis, require */
/**
 * K3 — 검증 · 보고서(순수 · UMD). 호스트(StcfsdPanel)가 require 하고, 화면(app.js)도 같은 것을 부른다.
 *
 * make(env) — 한 번의 검증 · 보고서를 만드는 묶음. env:
 *   doc        칸을 읽는 문서(getElementById · querySelector · querySelectorAll). 화면은 진짜 document,
 *              호스트는 검토 상태 · 모델로 만든 가짜 문서(src/case/reviewInput.ts — 칸의 글은 화면이 적는 12 자리 글)
 *   unitSystem 'SI' | 'US' — 보이는 단위
 *   model · analysisResult · lastDsmResult · lastProps · design · load · lap — 화면이 쥐는 결과의 사본(호스트는 그 거울)
 * 이 파일의 함수 몸은 app.js 에서 글 그대로 옮겼다(K3-1 · K3-4 — 값 · 글 · HTML 이 바이트까지 같게).
 * 고치는 것은 K3-6 부터, 각각 한 걸음씩(docs/implementation/20261124-k3-design.md 부록 A).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./utils.js'), require('./designState.js'));
    } else {
        root.StcfsdReview = factory(root.StcfsdUtils, root.StcfsdDesignState);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (UTILS, DS) {
    'use strict';
    const { fmt, verdictOf: _v3, notEvaluatedList: _notEvalList, warningsList: _warnList,
        assumptionsList: _assumpList, scopeNotesList: _scopeList, userText } = UTILS;
    void fmt;

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

    function make(env) {
        const document = env.doc;
        const _unitSystem = env.unitSystem === 'US' ? 'US' : 'SI';
        const model = env.model || null;
        const analysisResult = env.analysisResult || null;
        const lastDsmResult = env.lastDsmResult || null;
        const lastProps = env.lastProps || null;
        const _lastDesignResult = env.design || null;
        const _lastLoadAnalysis = env.load || null;
        const _lastLapResult = env.lap || null;

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

        function _esc(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

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

        function _verdictListsHtml(result, extraNotEval, extraWarn, extraAssump) {
            const ne = _notEvalList(result).concat((extraNotEval || []).filter(Boolean));
            const ws = _warnList(result).concat((extraWarn || []).filter(Boolean));
            const notChecked = (result && Array.isArray(result.not_checked)) ? result.not_checked : [];
            let h = '';
            const uniq = (arr) => arr.filter((x, i) => arr.indexOf(x) === i);
            if (ne.length > 0) {
                h += '<div class="verdict-not-evaluated" style="background:rgba(255,152,0,0.10);border-left:3px solid #ff9800;padding:4px 8px;margin:4px 0;font-size:11px">'
                    + '<b>평가하지 못한 항목 (판정 없음의 원인)</b>';
                uniq(ne).forEach(s => { h += '<div>• ' + _esc(s) + '</div>'; });
                h += '</div>';
            }
            if (notChecked.length > 0) {
                h += '<div class="verdict-not-checked" style="padding:4px 8px;margin:4px 0;font-size:11px;color:var(--vscode-descriptionForeground)">'
                    + '<b>검토하지 않은 항목 — 해당하면 별도 검토</b>';
                notChecked.forEach(s => { h += '<div>• ' + _esc(typeof s === 'string' ? s : JSON.stringify(s)) + '</div>'; });
                h += '</div>';
            }
            if (ws.length > 0) {
                h += '<div class="verdict-warnings" style="background:rgba(255,171,0,0.08);padding:4px 8px;margin:4px 0;font-size:11px;color:#f90">'
                    + '<b>경고 (값 또는 판정에 영향)</b>';
                uniq(ws).forEach(s => { h += '<div>• ' + _esc(s) + '</div>'; });
                h += '</div>';
            }
            // 가정(기본값으로 둔 입력·해석식 대체·보수측 대체) — 판정 아래 별도 블록
            const asm = (typeof _assumpList === 'function' ? _assumpList(result) : []).concat((extraAssump || []).filter(Boolean));
            if (asm.length > 0) {
                h += '<div class="verdict-assumptions" style="padding:4px 8px;margin:4px 0;font-size:11px;border-left:3px solid var(--vscode-panel-border)">'
                    + '<b>가정</b>';
                uniq(asm).forEach(s => { h += '<div>• ' + _esc(s) + '</div>'; });
                h += '</div>';
            }
            // 적용 범위 문장 — 늘 참인 범위 진술: 접어서 둔다
            const scope = typeof _scopeList === 'function' ? _scopeList(result) : [];
            if (scope.length > 0) {
                h += '<details class="verdict-scope" style="margin:2px 0;font-size:10px;color:var(--vscode-descriptionForeground)"><summary>적용 범위 (' + scope.length + ')</summary>';
                uniq(scope).forEach(s => { h += '<div>• ' + _esc(s) + '</div>'; });
                h += '</details>';
            }
            return h;
        }

        function _regionLabel(lbl) {
            const s = String(lbl || '');
            if (_unitSystem !== 'SI') { return s; }
            return s.replace(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) ft/g, (m0, a, b) =>
                fmtVal(Number(a), 'length_ft') + '–' + fmtVal(Number(b), 'length_ft') + ' ' + unitLabel('length_ft'));
        }

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

        function _deckNotes(deck) {
            const arr = (v) => Array.isArray(v) ? v.filter(Boolean).map(String) : [];
            if (!deck) { return { warnings: [], assumptions: [], scope: [] }; }
            const hasNew = Array.isArray(deck.warnings) || Array.isArray(deck.scope_notes) || Array.isArray(deck.assumptions);
            return {
                warnings: arr(deck.warnings),
                assumptions: arr(deck.assumptions),
                scope: hasNew ? arr(deck.scope_notes) : (deck.warning ? [String(deck.warning)] : []),
            };
        }

        function _isRRoute(d) {
            return !!(d && Array.isArray(d.steps) && d.steps.some(s => s && s.not_used === true)
                && d.R_uplift != null);
        }

        function _rRouteMnlo(d) {
            const s = Array.isArray(d && d.steps) ? d.steps.find(x => x && /Mnℓo|Mnlo/.test(String(x.name || ''))) : null;
            return s && typeof s.value === 'number' ? s.value : null;
        }

        function _requiredMoment(d) {
            if (!d) { return null; }
            if (typeof d.Mu_checked === 'number') { return d.Mu_checked; }
            if (typeof d.Mu === 'number') { return d.Mu; }
            const f = Array.isArray(d.limit_state_checks) ? d.limit_state_checks.find(c => c && c.name === 'F flexure') : null;
            if (f && typeof f.ratio === 'number' && d.design_strength > 0) { return f.ratio * d.design_strength; }
            return null;
        }

        function _rv(v, dec) { return v != null ? Number(v).toFixed(dec != null ? dec : 2) : '—'; }

        function _ruv(v, ut) { return fmtVal(v, ut); }

        function _rul(ut) { return unitLabel(ut); }

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

        function renderDiagramSVG(values, label, color, flipSign, dimLines, annotations, xCoords) {
            var hasAnn = annotations && annotations.length > 0;
            const W = 480, H = dimLines && dimLines.length > 0 ? 170 : (hasAnn ? 150 : 130), PAD_L = 6, PAD_R = 6, PAD_T = 22, PAD_B = dimLines && dimLines.length > 0 ? 48 : 18;
            const n = values.length;
            if (n < 2) return '';

            const vals = flipSign ? values.map(v => -v) : values;
            const maxAbs = Math.max(...vals.map(v => Math.abs(v)), 0.001);
            const plotW = W - PAD_L - PAD_R;
            const plotH = H - PAD_T - PAD_B;
            const scaleY = (plotH / 2) / maxAbs;
            const midY = PAD_T + plotH / 2;

            // x좌표 → 픽셀 매핑: 실제 물리좌표가 있으면 사용, 없으면 균등 인덱스
            const hasXCoords = xCoords && xCoords.length === n;
            const totalL = hasXCoords ? (xCoords[n - 1] - xCoords[0]) : 1;
            const x0 = hasXCoords ? xCoords[0] : 0;
            function idxToPixelX(i) {
                if (hasXCoords) {
                    return PAD_L + ((xCoords[i] - x0) / totalL) * plotW;
                }
                return PAD_L + (i / (n - 1)) * plotW;
            }

            let pathD = '';
            let maxI = 0, minI = 0;
            for (let i = 0; i < n; i++) {
                const x = idxToPixelX(i);
                const y = midY - vals[i] * scaleY;
                pathD += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
                if (vals[i] > vals[maxI]) maxI = i;
                if (vals[i] < vals[minI]) minI = i;
            }

            let fillD = pathD + 'L' + idxToPixelX(n - 1).toFixed(1) + ',' + midY + 'L' + PAD_L + ',' + midY + 'Z';

            // Max/min labels
            const maxX = idxToPixelX(maxI);
            const maxY = midY - vals[maxI] * scaleY;
            const minX = idxToPixelX(minI);
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
            // 치수선 (dimLines: [{startFrac, endFrac, label, color}])
            if (dimLines && dimLines.length > 0) {
                const dimY = midY + plotH / 2 + 10;
                dimLines.forEach((dl, di) => {
                    const x1 = PAD_L + dl.startFrac * plotW;
                    const x2 = PAD_L + dl.endFrac * plotW;
                    const dColor = dl.color || '#ff9800';
                    const yOff = dimY + di * 14;
                    // 변곡점 세로선
                    svg += '<line x1="' + x1.toFixed(1) + '" y1="' + (midY - plotH/2) + '" x2="' + x1.toFixed(1) + '" y2="' + (yOff + 2) + '" stroke="' + dColor + '" stroke-opacity="0.4" stroke-dasharray="2,2" stroke-width="0.7"/>';
                    // 지점 세로선 (이미 있으므로 치수선 영역까지만 연장)
                    svg += '<line x1="' + x2.toFixed(1) + '" y1="' + (midY + 3) + '" x2="' + x2.toFixed(1) + '" y2="' + (yOff + 2) + '" stroke="' + dColor + '" stroke-opacity="0.4" stroke-dasharray="2,2" stroke-width="0.7"/>';
                    // 수평 치수선
                    svg += '<line x1="' + x1.toFixed(1) + '" y1="' + yOff + '" x2="' + x2.toFixed(1) + '" y2="' + yOff + '" stroke="' + dColor + '" stroke-width="1"/>';
                    // 화살표
                    svg += '<polygon points="' + x1.toFixed(1) + ',' + yOff + ' ' + (x1+4).toFixed(1) + ',' + (yOff-2) + ' ' + (x1+4).toFixed(1) + ',' + (yOff+2) + '" fill="' + dColor + '"/>';
                    svg += '<polygon points="' + x2.toFixed(1) + ',' + yOff + ' ' + (x2-4).toFixed(1) + ',' + (yOff-2) + ' ' + (x2-4).toFixed(1) + ',' + (yOff+2) + '" fill="' + dColor + '"/>';
                    // 라벨
                    const midX = (x1 + x2) / 2;
                    svg += '<text x="' + midX.toFixed(1) + '" y="' + (yOff - 3) + '" fill="' + dColor + '" font-size="9" font-weight="600" text-anchor="middle">' + dl.label + '</text>';
                });
            }

            // annotations: [{frac, value, label, color}] — Lap 끝 등 특정 위치 표시
            if (annotations && annotations.length > 0) {
                annotations.forEach(function(ann) {
                    // 물리좌표 기반 인덱스 탐색 (부등경간 정확도)
                    var idx;
                    if (hasXCoords) {
                        var targetX = x0 + ann.frac * totalL;
                        idx = 0;
                        var bestDist = Math.abs(xCoords[0] - targetX);
                        for (var j = 1; j < n; j++) {
                            var d = Math.abs(xCoords[j] - targetX);
                            if (d < bestDist) { bestDist = d; idx = j; }
                        }
                    } else {
                        idx = Math.round(ann.frac * (n - 1));
                    }
                    if (idx < 0) idx = 0;
                    if (idx >= n) idx = n - 1;
                    var ax = idxToPixelX(idx);
                    var ay = midY - vals[idx] * scaleY;
                    var aColor = ann.color || '#ab47bc';
                    var aVal = flipSign ? -vals[idx] : vals[idx];
                    // 세로 점선
                    svg += '<line x1="' + ax.toFixed(1) + '" y1="' + (midY - plotH/2) + '" x2="' + ax.toFixed(1) + '" y2="' + (midY + plotH/2) + '" stroke="' + aColor + '" stroke-opacity="0.5" stroke-dasharray="3,2" stroke-width="0.8"/>';
                    // 점 마커
                    svg += '<circle cx="' + ax.toFixed(1) + '" cy="' + ay.toFixed(1) + '" r="3" fill="' + aColor + '" stroke="#fff" stroke-width="0.5"/>';
                    // 값 라벨
                    var labelY = ay > midY ? ay + 12 : ay - 5;
                    svg += '<text x="' + (ax + 4).toFixed(1) + '" y="' + labelY.toFixed(1) + '" fill="' + aColor + '" font-size="8.5" font-weight="600">' + aVal.toFixed(1) + '</text>';
                    // 위치 라벨
                    if (ann.label) {
                        svg += '<text x="' + ax.toFixed(1) + '" y="' + (midY - plotH/2 - 2) + '" fill="' + aColor + '" font-size="7.5" text-anchor="middle">' + ann.label + '</text>';
                    }
                });
            }

            // footer
            svg += '<text x="' + (W - PAD_R) + '" y="' + (H - 2) + '" fill="var(--vscode-descriptionForeground)" font-size="9" text-anchor="end">max=' + Math.max(...values).toFixed(1) + '  min=' + Math.min(...values).toFixed(1) + '</text>';
            svg += '</svg></div>';
            return svg;
        }

        function _canvasPng(id) {
            const c = document.getElementById(id);
            if (!c || typeof c.toDataURL !== 'function') { return ''; }
            try {
                const u = c.toDataURL('image/png');
                // 빈 캔버스(수백 바이트)나 실패는 제외
                return (u && u.length > 3000) ? u : '';
            } catch { return ''; }
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

            // ════════════════════════════════════════
            // A. 단면 입력
            // ════════════════════════════════════════
            const cat = 'A. 단면 입력';

            checks.push({
                category: cat, item: '단면 정의',
                status: (model && model.node && model.node.length > 0) ? 'pass' : 'fail',
                value: model ? (model.node||[]).length + ' 절점' : '0',
                criterion: '최소 1개 절점 정의 필요',
                note: model && model.node && model.node.length > 0 ? '' : '단면 미정의 — ①단면·재료 탭에서 템플릿을 생성하거나 절점/요소를 정의하세요.',
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
            const spanTblEls2 = Array.from(document.querySelectorAll('.span-tbl-len'));
            const spanIn = spanTblEls2.length > 0
                ? Math.max(...spanTblEls2.map(el => fromDisplay(parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0, 'length_ft') * 12))
                : 0;
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
                note: !analysisResult ? '③좌굴해석·부재설계 탭의 "A. 좌굴해석"에서 해석을 실행하세요.' : '',
            });

            const dP = dsm ? dsm.P : null;
            const dM = dsm ? dsm.Mxx : null;

            checks.push({
                category: catC, item: 'DSM 값 추출',
                status: dP || dM ? 'pass' : 'fail',
                value: dP ? 'Pcrl='+_rv(dP.crl)+', Pcrd='+_rv(dP.crd) : '미추출',
                criterion: 'Pcrl, Pcrd, Mcrl, Mcrd가 시그니처 곡선에서 식별되어야 함',
                note: !dP && !dM ? '해석을 먼저 실행하세요 — DSM 값은 자동 추출됩니다.' : '',
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
            const spacing = getNum('config-spacing', 3.281);
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

            checks.push({
                category: catE, item: '풍하중 (W, 양력)',
                status: 'pass',
                value: loadW > 0 ? loadW + ' ' + _rul('pressure') + ' ↑' : '없음',
                criterion: '양력 검토 시 Wu 입력 (uplift 조합)',
                note: loadW > 0 ? '양력 입력됨 — uplift 지배조합·R계수 검토를 확인하세요.' : '',
            });

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
                        note: (Array.isArray(_i6.reasons) && _i6.reasons.length > 0 ? _i6.reasons.join('; ') + ' — ' : '')
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
                    checks.push({
                        category: catF, item: '정모멘트 구간 구속',
                        status: 'pass',
                        value: '데크 연속 지지 (Ly=0)',
                        criterion: 'Through-fastened/Standing-seam 데크 시 LTB 불필요',
                        note: '',
                    });
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

            // ── 처짐 검증 (IBC Table 1604.3) ──
            if (la && la.deflection && la.deflection.valid !== false && la.deflection.per_span) {
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
                    checks.push({
                        category: catG, item: 'Mne vs My',
                        status: d.Mne != null && d.My != null ? (d.Mne <= mneLimit * 1.01 ? 'pass' : 'warn') : 'fail',
                        value: 'Mne='+_rv(d.Mne)+', My='+_rv(d.My) + (irApplied ? ', Mp='+_rv(d.Mp) : ''),
                        criterion: irApplied
                            ? '§F2.4.2 Inelastic Reserve: My ≤ Mne ≤ Mp'
                            : 'Mne ≤ My 예상 (LTB가 항복 이하로 감소)',
                        note: irApplied
                            ? 'Inelastic Reserve 적용됨 — Mne가 My를 초과합니다 (정상).'
                            : (d.Mne > d.My * 1.01 ? 'Mne > My — Cb 효과가 아니면 비정상. Lb와 Cb를 확인하세요.' : ''),
                    });

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
                            cwValue = 'Fya=' + _rv(d.Fy_used) + ' ksi (+' + d.cold_work.increase_pct + '%) — IR에는 원래 Fy 사용';
                            cwNote = '⚠ §A3.3.2: Cold Work(Fya)는 DSM 국부/뒤틀림에 적용되지만, Inelastic Reserve(Mne)에는 Fy_original=' + _rv(d.Fy_original) + ' ksi 사용.';
                        } else {
                            cwStatus = 'pass';
                            cwValue = 'Fya=' + _rv(d.Fy_used) + ' ksi (+' + d.cold_work.increase_pct + '%)';
                            cwNote = 'Fya=' + _rv(d.Fy_used) + ' > Fy=' + _rv(d.Fy_original) + ' — 코너부 냉간가공 효과 반영됨.';
                        }
                    } else if (cwRequested) {
                        cwStatus = 'fail';
                        cwValue = '적용 실패 — R/t 조건 미충족 또는 R=0';
                        cwNote = '코너 반경(R)과 두께(t)를 전처리에서 확인하세요. 조건: Fu/Fy≥1.2, R/t≤7, 각도≤120°.';
                    } else {
                        cwValue = '미적용 (Fy=' + _rv(d.Fy_original) + ' ksi)';
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
                                ? 'Cold Work(Fya)는 Mnl/Mnd에만 적용, Mne(IR)에는 원래 Fy=' + _rv(d.Fy_original) + ' ksi 사용. 두 옵션 중 하나만 사용을 권장.'
                                : 'Cold Work 조건 미충족으로 Fya 미적용. IR만 활성 상태.',
                        });
                    }

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
                    const allSame = (d.Mne === d.Mnl && d.Mnl === d.Mnd && d.Mnd === d.My);
                    let allSameNote = '';
                    if (allSame) {
                        const reasons = [];
                        if (dM && dM.crl > 0 && dM.P_y > 0) {
                            const lam_l = Math.sqrt(dM.P_y / dM.crl);
                            if (lam_l < 0.776) reasons.push('λl='+lam_l.toFixed(3)+' < 0.776 (국부좌굴 compact)');
                        }
                        if (dM && (dM.crd || 0) <= 0) reasons.push('Mcrd 미검출 (해석적 fallback §2.3.3.3 시도)');
                        if (dM && dM.crd > 0 && dM.P_y > 0) {
                            const lam_d = Math.sqrt(dM.P_y / dM.crd);
                            if (lam_d < 0.673) reasons.push('λd='+lam_d.toFixed(3)+' < 0.673 (뒤틀림 compact)');
                        }
                        if (reasons.length === 0) reasons.push('DSM 좌굴 감소가 적용되지 않음');
                        allSameNote = reasons.join('; ') + '. 두께를 줄이거나, Fy를 높이거나, 높이를 키우면 좌굴이 지배할 수 있습니다.';
                    }
                    checks.push({
                        category: catG, item: '모든 Mn 동일 (잠재적 문제)',
                        status: allSame ? 'warn' : 'pass',
                        value: allSame ? 'Mne=Mnl=Mnd=My='+_rv(d.My) : '값이 상이함 (정상)',
                        criterion: '네 값 모두 같으면 DSM이 좌굴 감소를 적용하지 않을 수 있음',
                        note: allSameNote,
                    });

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
                        if (d.Fy_used > 0 && prV.Fcre < 2.78 * d.Fy_used) {
                            checks.push({
                                category: catG, item: '정모멘트 LTB',
                                status: 'warn',
                                value: 'Fcre(+)=' + prV.Fcre + ' ksi < 2.78Fy=' + _rv(2.78 * d.Fy_used) + ' ksi',
                                criterion: '정모멘트 구간에서 LTB 발생 — Lb를 줄이거나 가새를 추가하세요',
                                note: '데크 없이 긴 비지지 길이에서 LTB가 휨강도를 크게 감소시킵니다.',
                            });
                        }
                    }
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

                // ── 이용률: 부모멘트 ──
                if (d.utilization != null && d.member_type === 'flexure') {
                    var _negUtil = d.utilization;
                    var _negLb2 = fromDisplay(getNum('design-Lb', 0), 'length');
                    var _negCb2 = getNum('design-Cb', 1.0);
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
                        value: 'Lb(-)=' + fmtVal(_negLb2, 'length') + ' ' + unitLabel('length') + ', Cb(-)=' + _negCb2,
                        criterion: '부모멘트 구간: 변곡점~Lap끝 또는 지점까지 비지지 길이',
                        note: _negLb2 <= 0 ? 'Lb=0 → 완전 구속 가정. 실제 조건을 확인하세요.' : (_negCb2 > 2.3 ? 'Cb > 2.3 — 매우 높은 값. 모멘트 다이어그램을 확인하세요.' : ''),
                    });
                } else if (d.utilization != null) {
                    checks.push({
                        category: catG, item: '이용률 (DCR)',
                        status: _statusFromVerdict(_v3(d), d.utilization),
                        value: (d.utilization*100).toFixed(1)+'% — '+_v3(d).short,
                        criterion: 'DCR ≤ 100%',
                        note: d.utilization > 1.0 ? '과응력 — 설계 요구사항 미충족.' : '',
                    });
                }

                // ── 이용률: 정모멘트 ──
                if (d.positive_region && d.member_type === 'flexure') {
                    var _posR = d.positive_region;
                    checks.push({
                        category: catG, item: '이용률 — 정모멘트 (+M)',
                        status: _posR.utilization != null ? _statusFromVerdict(_v3(_posR), _posR.utilization) : 'warn',
                        value: _posR.utilization != null ? (_posR.utilization*100).toFixed(1)+'%' : 'Mu(+) 미입력',
                        criterion: 'Mu(+) / φMn(+) ≤ 1.0',
                        note: _posR.utilization != null && _posR.utilization > 1.0
                            ? '정모멘트 구간 과응력 — Lb(+)를 줄이거나 가새를 추가하세요.'
                            : (_posR.utilization == null ? '설계탭에서 Mu(+) 값을 입력하세요.' : ''),
                    });
                    checks.push({
                        category: catG, item: 'Lb(+) / Cb(+) (정모멘트)',
                        status: _posR.Lb === 0 ? 'pass' : (d.Fy_used > 0 && _posR.Fcre >= 2.78 * d.Fy_used ? 'pass' : 'warn'),
                        value: 'Lb(+)=' + fmtVal(_posR.Lb, 'length') + ' ' + unitLabel('length') + ', Cb(+)=' + _posR.Cb + ', Fcre(+)=' + _posR.Fcre + ' ksi',
                        criterion: '정모멘트 구간: 데크 구속 시 Lb=0, 미구속 시 변곡점 간 거리',
                        note: _posR.Lb === 0
                            ? '데크에 의한 연속 구속 — LTB 없음.'
                            : (!(d.Fy_used > 0)
                                ? '결과에 Fy 가 없어 Fcre(+) ≥ 2.78Fy 를 판별하지 못했습니다.'
                                : _posR.Fcre < 2.78 * d.Fy_used
                                ? 'LTB 발생 — Fcre(+)=' + _posR.Fcre + ' ksi < 2.78Fy. 가새 추가 또는 Lb 감소를 검토하세요.'
                                : 'Fcre(+) ≥ 2.78Fy — LTB 없음.'),
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
                        status: _statusFromVerdict(_v3(d.interaction), d.interaction.total),
                        value: _rv(d.interaction.total,4)+' ≤ 1.0 — '+_v3(d.interaction).short,
                        criterion: 'P/Pa + Mx/Max + My/May ≤ 1.0',
                        note: _v3(d.interaction).state === 'FAIL' ? '조합 검토 실패 — 하중을 줄이거나 단면을 키우세요.'
                            : (_v3(d.interaction).state === 'NOT_CHECKED' ? '조합 검토 판정 없음 — 구성 강도 중 평가하지 못한 것이 있습니다.' : ''),
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

                // 설계 결과 warnings (Mcrd fallback, R-factor 등 — 정모멘트 NG 중복 제외)
                if (d.warnings && d.warnings.length > 0) {
                    d.warnings.forEach((w, i) => {
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
                        checks.push({
                            category: catG2, item: 'Lap 구간 휨강도 (§F3, 2겹)',
                            status: _statusFromVerdict(_v3(lapDesign), lapDesign.utilization),
                            value: (lapDesign.design_strength != null ? (_ruv(lapDesign.design_strength, 'moment') + ' ' + _rul('moment')) : '미계산') + ' — ' + _v3(lapDesign).short,
                            criterion: '2겹 합산 φMn ≥ 지점 Mu (AISI Ex. II-2A)',
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
                        checks.push({
                            category: catG2, item: 'Lap 패스너 전단 (DCR)',
                            status: _lr.utilization != null ? _statusFromVerdict(_ratioVerdict(_lr.utilization, _lr.pass === true), _lr.utilization) : 'warn',
                            value: _lr.utilization != null
                                ? 'DCR=' + _lr.utilization.toFixed(3) + ' (V=' + _ruv(_lr.V_transfer, 'force') + ' / Cap=' + _ruv(_lr.capacity, 'force') + ' ' + _rul('force') + ')'
                                : '미계산',
                            criterion: '패스너 전단 DCR ≤ 1.0',
                            note: _lr.utilization > 1.0 ? '패스너 용량 부족 — 패스너 수 또는 사양을 변경하세요.' : '',
                        });
                        // Lap 휨강도 DCR
                        var _lrGov = (_lr.flexure_dcr_governing != null) ? _lr.flexure_dcr_governing : _lr.flexure_dcr;
                        if (_lrGov != null) {
                            checks.push({
                                category: catG2, item: 'Lap 휨강도 DCR (2겹 §F3/F4/H2)',
                                status: _statusFromVerdict(_ratioVerdict(_lrGov, _lr.flexure_checked === true), _lrGov),
                                value: 'DCR=' + _lrGov.toFixed(3) + ' (φMn=' + _ruv(_lr.phi_Mn_lap, 'moment') + ' ' + _rul('moment') + ')',
                                criterion: '2겹 합산 휨강도 DCR ≤ 1.0',
                                note: _lrGov > 1.0 ? 'Lap 구간 휨강도 부족 — 단면을 키우거나 Fy를 높이세요.' : '',
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
            const fyLoad = getNum('input-fy', 0);   // 빈 칸 = 0 → 불일치로 보인다(기본 강종으로 맞추지 않는다)
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
                    const _isM = dsmD.load_type && dsmD.load_type !== 'P';
                    if (dsmD.LF_local > 0 && dsmD.Lcrl > 0) extrema.push({L:dsmD.Lcrl,LF:dsmD.LF_local,label:_isM?'Mcrl':'Pcrl',color:'#ff5722'});
                    if (dsmD.LF_dist > 0 && dsmD.Lcrd > 0) extrema.push({L:dsmD.Lcrd,LF:dsmD.LF_dist,label:_isM?'Mcrd':'Pcrd',color:'#ffab00'});
                    if (dsmD.LF_global > 0 && dsmD.Lcre > 0) extrema.push({L:dsmD.Lcre,LF:dsmD.LF_global,label:_isM?'Mcre':'Pcre',color:'#7c4dff'});
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
                h += '<tr><td>P<sub>crl</sub> (국부)</td><td>'+_ruv(dP.crl,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcrl,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_local,4)+'</td></tr>';
                h += '<tr><td>P<sub>crd</sub> (뒤틀림)</td><td>'+_ruv(dP.crd,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcrd,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_dist,4)+'</td></tr>';
                h += '<tr><td>P<sub>cre</sub> (전체)</td><td>'+_ruv(dP.cre,'force')+' '+_fU+'</td><td>'+_ruv(dP.Lcre,'length')+' '+_lU+'</td><td>'+_rv(dP.LF_global,4)+'</td></tr>';
                h += '<tr><td colspan="4" style="font-weight:600;background:#f0f0f0">휨 ('+_mU+')</td></tr>';
                h += '<tr><td>M<sub>y</sub> (항복)</td><td>'+_ruv(dM.P_y,'moment')+' '+_mU+'</td><td></td><td></td></tr>';
                h += '<tr><td>M<sub>crl</sub> (국부)</td><td>'+_ruv(dM.crl,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcrl,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_local,4)+'</td></tr>';
                h += '<tr><td>M<sub>crd</sub> (뒤틀림)</td><td>'+_ruv(dM.crd,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcrd,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_dist,4)+'</td></tr>';
                h += '<tr><td>M<sub>cre</sub> (전체)</td><td>'+_ruv(dM.cre,'moment')+' '+_mU+'</td><td>'+_ruv(dM.Lcre,'length')+' '+_lU+'</td><td>'+_rv(dM.LF_global,4)+'</td></tr>';
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

        function _rptDesignInput(la, _d) {
            let h = '';

            // 재료 (입력 필드값은 이미 표시 단위 → 직접 사용, US 상수는 _ruv로 변환)
            // 빈 칸은 빈 칸으로 적는다(기본 강종 값을 보고서에 지어 넣지 않는다).
            const fy = getNum('design-fy', '—'), fu = getNum('design-fu', '—');
            // 강종 셀렉트 id는 input-steel-grade (구 select-steel-grade는 미존재 → 항상 'Custom' 표시됐음)
            const gradeEl = document.getElementById('input-steel-grade');
            const gradeName = (gradeEl && gradeEl.selectedIndex >= 0 && gradeEl.value)
                ? gradeEl.options[gradeEl.selectedIndex].text : 'Custom (직접 입력)';
            h += '<h3>재료</h3>';
            h += '<table><tr><th>항목</th><th>값</th><th>단위</th></tr>';
            h += '<tr><td>강종</td><td colspan="2">'+gradeName+'</td></tr>';
            h += '<tr><td>항복강도, F<sub>y</sub></td><td>'+fy+'</td><td>'+_rul('stress')+'</td></tr>';
            h += '<tr><td>인장강도, F<sub>u</sub></td><td>'+fu+'</td><td>'+_rul('stress')+'</td></tr>';
            h += '<tr><td>탄성계수, E</td><td>'+_ruv(29500,'stress')+'</td><td>'+_rul('stress')+'</td></tr>';
            h += '<tr><td>포아송비, &nu;</td><td>0.30</td><td></td></tr>';
            h += '</table>';

            // 부재 구성
            const memberApp = document.getElementById('select-member-type');
            const memberName = memberApp ? memberApp.options[memberApp.selectedIndex].text : '';
            const spanEl = document.getElementById('select-span-type');
            const spanName = spanEl ? spanEl.options[spanEl.selectedIndex].text : '';
            const _spanTblEls = Array.from(document.querySelectorAll('.span-tbl-len'));
            const spanVals = _spanTblEls.map(el => parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0).filter(v => v > 0);
            const spanText = spanVals.length > 0 ? spanVals.join(', ') + ' ' + _rul('length_ft') : '';
            const spacing = getNum('config-spacing',5);
            const dm = document.getElementById('select-design-method');
            const dmName = dm ? dm.value : 'LRFD';

            h += '<h3>부재 구성</h3>';
            h += '<table><tr><th>항목</th><th>값</th></tr>';
            if (memberName) h += '<tr><td>부재 적용</td><td>'+memberName+'</td></tr>';
            if (spanName) h += '<tr><td>스팬 유형</td><td>'+spanName+(la?' ('+la.n_spans+'경간)':'')+'</td></tr>';
            if (spanText) h += '<tr><td>스팬 길이</td><td>'+spanText+'</td></tr>';
            h += '<tr><td>분담폭 (간격)</td><td>'+spacing+' '+_rul('length_ft')+'</td></tr>';
            h += '<tr><td>설계 방법</td><td>'+dmName+'</td></tr>';
            const lapPairs = [];
            document.querySelectorAll('.span-tbl-lapl').forEach((el, idx) => {
                const left = parseFloat(/** @type {HTMLInputElement} */ (el).value) || 0;
                const rightEl = document.querySelector('.span-tbl-lapr[data-idx="' + idx + '"]');
                const right = rightEl ? parseFloat(/** @type {HTMLInputElement} */ (rightEl).value) || 0 : 0;
                if (left || right) lapPairs.push('S' + idx + ': ' + left + ' / ' + right + ' ' + _rul('length_ft'));
            });
            if (lapPairs.length > 0) h += '<tr><td>랩 길이 (좌 / 우)</td><td>'+lapPairs.join('<br>')+'</td></tr>';
            h += '</table>';

            // 설계하중 (psf, spacing은 이미 표시 단위값)
            h += '<h3>설계 하중</h3>';
            h += '<table><tr><th>하중 유형</th><th>'+_rul('pressure')+'</th><th>'+_rul('linload')+' (&times;'+spacing+' '+_rul('length_ft')+')</th><th>설명</th></tr>';
            const loadDefs = [
                ['D','load-D-psf','고정하중 (자중 + 부가하중)'],
                ['Lr','load-Lr-psf','지붕 활하중'],
                ['S','load-S-psf','적설하중'],
                ['L','load-L-psf','바닥 활하중'],
                ['Wu (양력)','load-Wu-psf','풍양력 하중(부압)'],
                ['Wp (정압)','load-Wp-psf','풍정압 하중'],
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

        function _rptLoadAnalysis(la) {
            let h = '';
            const rptGov = la.governing || la.gravity;
            // Lap 끝 annotations (보고서용)
            var rptMann = [], rptVann = [];
            if (rptGov && rptGov.locations && la.spans_ft) {
                var rptTotalL = la.spans_ft.reduce(function(a,b){return a+b;}, 0);
                if (rptTotalL > 0) {
                    rptGov.locations.forEach(function(loc) {
                        if ((loc.name || '').indexOf('Lap end') === 0 && loc.x_ft != null) {
                            var fr = loc.x_ft / rptTotalL;
                            rptMann.push({ frac: fr, value: _unitSystem === 'SI' ? toDisplay(loc.Mu,'moment_ft') : loc.Mu, label: 'Lap end', color: '#ab47bc' });
                            if (loc.Vu != null) rptVann.push({ frac: fr, value: _unitSystem === 'SI' ? toDisplay(loc.Vu,'force') : loc.Vu, label: 'Lap end', color: '#ab47bc' });
                        }
                    });
                }
            }
            if (rptGov && rptGov.M_diagram && rptGov.M_diagram.length > 2) {
                h += renderBeamSchematic(la);
                const mVals = _unitSystem === 'SI' ? rptGov.M_diagram.map(v => toDisplay(v,'moment_ft')) : rptGov.M_diagram;
                const rptXCoords = rptGov.x_diagram || null;
                h += renderDiagramSVG(mVals, '지배 조합 모멘트: '+rptGov.combo+' ('+_rul('moment_ft')+')', '#1565c0', true, null, rptMann, rptXCoords);
            }
            if (rptGov && rptGov.V_diagram && rptGov.V_diagram.length > 2) {
                const vVals = _unitSystem === 'SI' ? rptGov.V_diagram.map(v => toDisplay(v,'force')) : rptGov.V_diagram;
                const rptVXCoords = rptGov.x_diagram || null;
                h += renderDiagramSVG(vVals, '지배 조합 전단력: '+rptGov.combo+' ('+_rul('force')+')', '#e65100', false, null, rptVann, rptVXCoords);
            }

            if (rptGov) {
                // 위치별 값은 하중조합·부분재하 포락이다 — 위치마다 지배 조합/패턴을 함께 적는다.
                h += '<h3>소요강도 포락 (대표 조합: '+rptGov.combo+')</h3>';
                h += '<table><tr><th>위치</th><th>x ('+_rul('length_ft')+')</th><th>M<sub>u</sub> ('+_rul('moment_ft')+')</th><th>V<sub>u</sub> ('+_rul('force')+')</th><th>R 지압 / 인발 ('+_rul('force')+')</th><th>구간</th><th>지배 조합 · 패턴</th></tr>';
                rptGov.locations.forEach(loc => {
                    // R_bearing(지압, +) / R_uplift(인발, 부호 유지)를 쓴다. Ru 는 뜻이 바뀌었다(중력=지압, 양력=인발 크기).
                    var rTxt = (loc.R_bearing != null || loc.R_uplift != null)
                        ? (loc.R_bearing != null ? _ruv(loc.R_bearing,'force') : '—') + ' / ' + (loc.R_uplift != null ? _ruv(loc.R_uplift,'force') : '—')
                        : (loc.Ru != null ? _ruv(loc.Ru,'force') + ' (크기)' : '—');
                    var patTxt = loc.pattern && typeof loc.pattern === 'object' ? Object.keys(loc.pattern).map(k => k + ':' + loc.pattern[k]).join(', ') : (loc.pattern || '');
                    h += '<tr><td>'+loc.name+'</td><td>'+_ruv(loc.x_ft,'length_ft')+'</td><td>'+_ruv(loc.Mu,'moment_ft')+'</td><td>'+_ruv(loc.Vu,'force')+'</td><td>'+rTxt+'</td><td>'+( loc.region||'')+'</td><td>'+_esc((loc.combo||'') + (patTxt ? ' · ' + patTxt : ''))+'</td></tr>';
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
                    const isGov = cd.governs_gravity || cd.governs_uplift || cd.governs_overall;
                    const bld = cd.governs_overall ? 'font-weight:700;background:#e3f2fd' : (isGov ? 'font-weight:700;background:#f0f7f0' : '');
                    const terms = [];
                    for (const [lt, factor] of Object.entries(cd.factors)) {
                        const w = plf[lt];
                        if (w == null) continue;
                        const fStr = factor === 1.0 ? '' : factor+'&times;';
                        terms.push('<b>'+fStr+'</b>'+(_loadLabels[lt]||lt)+'('+_ruv(Math.abs(w),'linload')+')');
                    }
                    let govTag = '';
                    if (cd.governs_overall) govTag += '<b style="color:#2196f3">★지배</b> ';
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
                    h += '<td>'+(ap.deck.kphi_method === 'test_override' ? '프로젝트 시험 입력값' : 'Gao &amp; Moen (2011) 식, Design Manual Example II-1C 방식 예비설계값')+'</td></tr>';
                    h += '<tr><td>k<sub>x</sub> (횡강성)</td><td>'+_ruv(ap.deck.kx,'latStiff')+' '+_rul('latStiff')+'</td>';
                    h += '<td>'+(ap.deck.kx_method === 'test_override' ? '프로젝트 시험 입력값' : 'AISI RP17-2 곡선 맞춤식 (Example II-1C 패스너 값 기준 예비설계값)')+'</td></tr>';
                    _deckNotes(ap.deck).warnings.forEach(w => { h += '<tr><td colspan="3" style="color:#b36b00">주의: '+_esc(userText(w))+'</td></tr>'; });
                    _deckNotes(ap.deck).assumptions.forEach(a => { h += '<tr><td colspan="3">가정: '+_esc(userText(a))+'</td></tr>'; });
                    _deckNotes(ap.deck).scope.forEach(s => { h += '<tr><td colspan="3" style="color:#666">범위: '+_esc(userText(s))+'</td></tr>'; });
                }
                if (ap.positive_region) {
                    if (ap.positive_region.braced) {
                        h += '<tr><td>정모멘트 L<sub>y</sub>(+)</td><td>0 (완전 지지)</td>';
                        h += '<td>상부 플랜지 압축, 데크 패널로 연속 지지 — LTB 검토 불필요</td></tr>';
                    } else {
                        h += '<tr><td>정모멘트 L<sub>y</sub>(+)</td><td>'+_ruv(ap.positive_region.Ly_in,'length')+' '+_rul('length')+'</td>';
                        h += '<td>상부 플랜지 비지지 — 변곡점 간 거리 기준 LTB 검토 필요</td></tr>';
                        h += '<tr><td>정모멘트 C<sub>b</sub>(+)</td><td>'+ap.positive_region.Cb+'</td>';
                        h += '<td>AISI Eq. F2.1.1-2 — 정모멘트 구간 모멘트 다이어그램에서 계산</td></tr>';
                    }
                }
                if (ap.negative_region) {
                    h += '<tr><td>부모멘트 L<sub>y</sub></td><td>'+_ruv(ap.negative_region.Ly_in,'length')+' '+_rul('length')+'</td>';
                    h += '<td>변곡점(M=0)에서 랩 끝단 또는 지점까지 거리. 하부 플랜지 압축 — 비지지.</td></tr>';
                    h += '<tr><td>부모멘트 C<sub>b</sub></td><td>'+ap.negative_region.Cb+'</td>';
                    h += '<td>AISI Eq. F2.1.1-2: C<sub>b</sub> = 12.5M<sub>max</sub> / (2.5M<sub>max</sub>+3M<sub>A</sub>+4M<sub>B</sub>+3M<sub>C</sub>), 비지지 구간 모멘트 다이어그램에서 계산</td></tr>';
                }
                if (ap.uplift_R != null) {
                    h += '<tr><td>양력 R (§I6.2.1)</td><td>'+ap.uplift_R+'</td>';
                    h += '<td>AISI S100 Table I6.2.1-1 — 조건 (a)–(o) 확인 시에만 ('+_esc(ap.uplift_R_basis || '')+')</td></tr>';
                } else if (ap.i621_check || ap.uplift_R === null) {
                    var _rs = (ap.i621_check && Array.isArray(ap.i621_check.reasons)) ? ap.i621_check.reasons.join('; ') : '';
                    h += '<tr><td>양력 R (§I6.2.1)</td><td>— (적용 안 함)</td>';
                    h += '<td>§I6.2.1 조건 미확인 또는 불충족 — R 법으로 판정하지 않음'+(_rs ? ': '+_esc(_rs) : '')+'</td></tr>';
                }
                if (ap.unbraced && ap.unbraced.inflection_points_ft) {
                    h += '<tr><td>변곡점</td><td>'+ap.unbraced.inflection_points_ft.map(v=>_ruv(v,'length_ft')).join(', ')+' '+_rul('length_ft')+'</td>';
                    h += '<td>모멘트 = 0인 위치, 모멘트 다이어그램의 선형보간으로 산출</td></tr>';
                }
                h += '</table>';
            }

            // 처짐 결과
            if (la.deflection && la.deflection.valid !== false && la.deflection.D_diagram && la.deflection.D_diagram.length > 2) {
                h += '<h3>처짐 검토 (사용하중: '+la.deflection.combo+')</h3>';
                const dVals = _unitSystem === 'SI'
                    ? la.deflection.D_diagram.map(v => toDisplay(v, 'length'))
                    : la.deflection.D_diagram;
                const rptDXCoords = (rptGov && rptGov.x_diagram) || null;
                h += renderDiagramSVG(dVals, '처짐 다이어그램 ('+_rul('length')+')', '#66bb6a', true, null, null, rptDXCoords);

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
            } else if (la.deflection && la.deflection.valid === false) {
                h += '<h3>처짐 검토</h3><p style="color:var(--vscode-errorForeground)">처짐 해석이 실패하여 결과를 사용할 수 없습니다. FE 해석 설정과 지점/Lap 입력을 확인하세요.</p>';
            }

            return h;
        }

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
                const irV = _v3(ir);
                h += '<tr style="font-weight:700"><td>합계</td><td colspan="2"></td><td class="'+irV.cls+'">'+_rv(ir.total,4)+' &le; 1.0 '+irV.short+'</td></tr>';
                h += '</table>';
            }
            if (d.shear_interaction) {
                const si = d.shear_interaction;
                h += '<h3>휨 + 전단 조합 검토 — §H2 (Eq. '+(si.equation||'H2-1')+')</h3>';
                h += '<span class="eq">(M<sub>u</sub>/M<sub>alo</sub>)&sup2; + (V<sub>u</sub>/V<sub>a</sub>)&sup2; &le; 1.0</span>';
                h += '<table><tr><th>항</th><th>비율</th></tr>';
                // V4-04: 분모는 Malo(국부좌굴 강도, Fn = Fy) — 지배 휨강도가 아니다.
                if (si.Malo != null) {
                    h += '<tr><td>M<sub>alo</sub> (M<sub>nlo</sub> ' + (si.Mnlo != null ? _ruv(si.Mnlo, 'moment') : '—') + ')</td><td>' + _ruv(si.Malo, 'moment') + ' ' + _rul('moment') + '</td></tr>';
                }
                h += '<tr><td>M/Malo</td><td>'+_rv(si.M_ratio,4)+'</td></tr>';
                h += '<tr><td>V/Va</td><td>'+_rv(si.V_ratio,4)+'</td></tr>';
                const siV = _v3(si);
                h += '<tr style="font-weight:700"><td>합계 (SRSS)</td><td class="'+siV.cls+'">'+_rv(si.total,4)+' &le; 1.0 '+siV.short+'</td></tr>';
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

            // 정/부 모멘트 구간이 모두 있으면 섹션 제목 추가
            if (d.positive_region) {
                h += '<h2 style="color:#ff9800">1) 부모멘트 구간 (-M)</h2>';
                var _nLb = fromDisplay(getNum('design-Lb', 0), 'length');
                var _nCb = getNum('design-Cb', 1.0);
                h += '<p>Lb(-) = '+_ruv(_nLb,'length')+' '+_rul('length')+', Cb(-) = '+_nCb+'</p>';
            }

            // Step 1: My
            h += '<h3>단계 1: 항복 모멘트, M<sub>y</sub></h3>';
            h += '<span class="eq">M<sub>y</sub> = S<sub>f</sub> &times; F<sub>y</sub> = '+_ruv(d.My,'moment')+' '+_rul('moment')+'</span>';

            // Step 2: Global/LTB — Mne
            // V4-30: R 경로면 단계 2–4 는 참고(강도에 쓰지 않음)라고 머리에 밝힌다.
            const _rRef = _isRRoute(d) ? ' <span style="font-weight:normal;color:#888">[참고 — §I6.2.1 R 계수법이 대신함, 강도에 쓰지 않음]</span>' : '';
            h += '<h3>단계 2: 전체좌굴 / 횡-비틀림좌굴 — §F2' + _rRef + '</h3>';
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
            h += '<h3>단계 3: 국부좌굴 — §F3.2' + _rRef + '</h3>';
            h += '<p>국부 세장비 &lambda;<sub>l</sub>이 0.776을 초과하면 국부좌굴이 전체강도 M<sub>ne</sub>를 감소시킵니다:</p>';
            h += '<span class="eq">&lambda;<sub>l</sub> = &radic;(M<sub>ne</sub> / M<sub>crl</sub>)</span>';
            h += '<table><tr><th>조건</th><th>수식</th></tr>';
            h += '<tr><td>&lambda;<sub>l</sub> &le; 0.776</td><td>M<sub>nl</sub> = M<sub>ne</sub> (감소 없음)</td></tr>';
            h += '<tr><td>&lambda;<sub>l</sub> &gt; 0.776</td><td>M<sub>nl</sub> = [1 - 0.15(M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup>] &middot; (M<sub>crl</sub>/M<sub>ne</sub>)<sup>0.4</sup> &middot; M<sub>ne</sub></td></tr>';
            h += '</table>';
            const govL = d.Mnl < d.Mne ? ' (국부좌굴로 강도 '+(100*(1-d.Mnl/d.Mne)).toFixed(1)+'% 감소)' : ' (감소 없음)';
            h += '<span class="eq">M<sub>nl</sub> = <b>'+_ruv(d.Mnl,'moment')+'</b> '+_rul('moment')+govL+'</span>';

            // Step 4: Distortional — Mnd
            h += '<h3>단계 4: 뒤틀림좌굴 — §F4' + _rRef + '</h3>';
            h += '<p>뒤틀림좌굴은 M<sub>y</sub>에 대해 독립적으로 검토합니다:</p>';
            h += '<span class="eq">&lambda;<sub>d</sub> = &radic;(M<sub>y</sub> / M<sub>crd</sub>)</span>';
            h += '<table><tr><th>조건</th><th>수식</th></tr>';
            h += '<tr><td>&lambda;<sub>d</sub> &le; 0.673</td><td>M<sub>nd</sub> = M<sub>y</sub> (감소 없음)</td></tr>';
            h += '<tr><td>&lambda;<sub>d</sub> &gt; 0.673</td><td>M<sub>nd</sub> = [1 - 0.22(M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup>] &middot; (M<sub>crd</sub>/M<sub>y</sub>)<sup>0.5</sup> &middot; M<sub>y</sub></td></tr>';
            h += '</table>';
            h += '<span class="eq">M<sub>nd</sub> = <b>'+_ruv(d.Mnd,'moment')+'</b> '+_rul('moment')+'</span>';

            // Step 5: 부모멘트 구간 공칭강도 & 설계강도
            if (d.positive_region) {
                h += '<h3>단계 5: 부모멘트 구간 (-M) 공칭강도 & 설계강도</h3>';
            } else {
                h += '<h3>단계 5: 공칭강도 & 설계강도</h3>';
            }
            if (_isRRoute(d)) {
                // V4-30: §I6.2.1 R 경로 — 엔진이 보고한 길(Mn = R·Mnℓo)을 그대로. F2 · F3 · F4 값은 참고.
                h += '<span class="eq">M<sub>n</sub>(-) = R &middot; M<sub>nℓo</sub> = '+d.R_uplift+' &times; '+_ruv(_rRouteMnlo(d),'moment')+' = <b>'+_ruv(d.Mn,'moment')+'</b> '+_rul('moment')+' (§I6.2.1, Eq. I6.2.1-1)</span>';
                h += '<span class="eq" style="opacity:0.6">참고(강도에 쓰지 않음): M<sub>ne</sub> '+_ruv(d.Mne,'moment')+', M<sub>nl</sub> '+_ruv(d.Mnl,'moment')+', M<sub>nd</sub> '+_ruv(d.Mnd,'moment')+'</span>';
            } else {
                h += '<span class="eq">M<sub>n</sub>(-) = min(M<sub>ne</sub>, M<sub>nl</sub>, M<sub>nd</sub>) = min('+_ruv(d.Mne,'moment')+', '+_ruv(d.Mnl,'moment')+', '+_ruv(d.Mnd,'moment')+') = <b>'+_ruv(d.Mn,'moment')+'</b> '+_rul('moment')+'</span>';
            }
            h += '<span class="eq">지배 파괴 모드: <b>'+(d.controlling_mode||'')+'</b></span>';
            if (dm==='LRFD') {
                h += '<span class="eq">&phi;<sub>b</sub> = '+phi+' (LRFD)</span>';
                h += '<span class="eq">&phi;M<sub>n</sub>(-) = '+phi+' &times; '+_ruv(d.Mn,'moment')+' = <b class="result">'+_ruv(d.phi_Mn,'moment')+'</b> '+_rul('moment')+'</span>';
            } else {
                h += '<span class="eq">&Omega;<sub>b</sub> = '+omega+' (ASD)</span>';
                h += '<span class="eq">M<sub>n</sub>(-)/&Omega; = '+_ruv(d.Mn,'moment')+' / '+omega+' = <b class="result">'+_ruv(d.Mn_omega,'moment')+'</b> '+_rul('moment')+'</span>';
            }
            if (d.utilization != null) {
                // V4-15: 소요 모멘트는 결과의 값(검토점 Mu_checked) 또는 F 검토의 비 × 그 강도 — 전체 이용률(H2 · G5 가
                // 지배할 수 있음) × 강도로 역산하지 않는다.
                const Mu = _requiredMoment(d);
                const _fV = _checkVerdict(d, 'F flexure', d.utilization);
                h += '<span class="eq">M<sub>u</sub>(-) / '+(dm==='LRFD'?'&phi;M<sub>n</sub>(-)':'M<sub>n</sub>(-)/&Omega;')+' = '+_ruv(Mu,'moment')+' / '+_ruv(d.design_strength,'moment')+' = <b class="'+_fV.cls+'">'+_rv(d.utilization*100,1)+'%</b> '+_fV.short+'</span>';
            }

            // ── 정모멘트 구간: 부모멘트와 동일한 단계별 형식 ──
            if (d.positive_region) {
                var pr = d.positive_region;

                h += '<hr style="margin:16px 0;border:none;border-top:2px solid #4caf50;opacity:0.4">';
                h += '<h2 style="color:#4caf50">2) 정모멘트 구간 (+M)</h2>';
                h += '<p>Lb(+) = '+_ruv(pr.Lb,'length')+' '+_rul('length')+', Cb(+) = '+pr.Cb+'</p>';

                // Step 1: My (동일)
                h += '<h3>단계 1: 항복 모멘트, M<sub>y</sub></h3>';
                h += '<span class="eq">M<sub>y</sub> = S<sub>f</sub> &times; F<sub>y</sub> = '+_ruv(d.My,'moment')+' '+_rul('moment')+' (부모멘트 구간과 동일)</span>';

                // Step 2: Global/LTB — Mne(+)
                h += '<h3>단계 2: 전체좌굴 / 횡-비틀림좌굴 — §F2 (정모멘트)</h3>';
                h += '<p>정모멘트 구간의 Lb(+)='+_ruv(pr.Lb,'length')+' '+_rul('length')+', Cb(+)='+pr.Cb+'로 Fcre를 재산정합니다.</p>';
                h += '<span class="eq">F<sub>cre</sub>(+) = '+pr.Fcre+' ksi → '+( pr.equation||'§F2.1')+'</span>';
                // Fcre vs 2.78Fy 판별
                var Fy_val = d.Fy_used || d.Fy_original;
                if (!(Fy_val > 0)) {
                    h += '<span class="eq">(결과에 Fy 가 없어 Fcre 구간 판별을 적지 않습니다)</span>';
                } else if (pr.Fcre >= 2.78 * Fy_val) {
                    h += '<span class="eq">F<sub>cre</sub>(+) = '+pr.Fcre+' ksi &ge; 2.78F<sub>y</sub> = '+_rv(2.78*Fy_val,1)+' ksi → F<sub>n</sub> = F<sub>y</sub> (항복)</span>';
                } else if (pr.Fcre > 0.56 * Fy_val) {
                    h += '<span class="eq">0.56F<sub>y</sub> < F<sub>cre</sub>(+) = '+pr.Fcre+' ksi < 2.78F<sub>y</sub> → 비탄성 LTB</span>';
                } else {
                    h += '<span class="eq">F<sub>cre</sub>(+) = '+pr.Fcre+' ksi &le; 0.56F<sub>y</sub> = '+_rv(0.56*Fy_val,1)+' ksi → 탄성 LTB</span>';
                }
                h += '<span class="eq">M<sub>ne</sub>(+) = <b>'+_ruv(pr.Mne,'moment')+'</b> '+_rul('moment')+'</span>';

                // Step 3: Local — Mnl(+)
                h += '<h3>단계 3: 국부좌굴 — §F3.2 (정모멘트)</h3>';
                var govLpos = pr.Mnl < pr.Mne ? ' (국부좌굴로 '+(100*(1-pr.Mnl/pr.Mne)).toFixed(1)+'% 감소)' : ' (감소 없음)';
                h += '<span class="eq">M<sub>nl</sub>(+) = <b>'+_ruv(pr.Mnl,'moment')+'</b> '+_rul('moment')+govLpos+'</span>';

                // Step 4: Distortional — Mnd(+)
                h += '<h3>단계 4: 뒤틀림좌굴 — §F4 (정모멘트)</h3>';
                h += '<span class="eq">M<sub>nd</sub>(+) = <b>'+_ruv(pr.Mnd,'moment')+'</b> '+_rul('moment')+'</span>';

                // Step 5: Nominal & Design
                h += '<h3>단계 5: 공칭강도 & 설계강도 (정모멘트)</h3>';
                h += '<span class="eq">M<sub>n</sub>(+) = min(M<sub>ne</sub>, M<sub>nl</sub>, M<sub>nd</sub>) = min('+_ruv(pr.Mne,'moment')+', '+_ruv(pr.Mnl,'moment')+', '+_ruv(pr.Mnd,'moment')+') = <b>'+_ruv(pr.Mn,'moment')+'</b> '+_rul('moment')+'</span>';
                var dsLabel = dm==='LRFD'?'&phi;M<sub>n</sub>(+)':'M<sub>n</sub>(+)/&Omega;';
                if (dm==='LRFD') {
                    h += '<span class="eq">&phi;<sub>b</sub> = '+phi+' (LRFD)</span>';
                    h += '<span class="eq">'+dsLabel+' = '+phi+' &times; '+_ruv(pr.Mn,'moment')+' = <b class="result">'+_ruv(pr.phi_Mn,'moment')+'</b> '+_rul('moment')+'</span>';
                } else {
                    h += '<span class="eq">&Omega;<sub>b</sub> = '+omega+' (ASD)</span>';
                    h += '<span class="eq">'+dsLabel+' = '+_ruv(pr.Mn,'moment')+' / '+omega+' = <b class="result">'+_ruv(pr.phi_Mn,'moment')+'</b> '+_rul('moment')+'</span>';
                }
                if (pr.Mu_pos > 0) {
                    var prDCR = pr.utilization != null ? pr.utilization : 0;
                    var prV = _v3(pr);
                    h += '<span class="eq">M<sub>u</sub>(+) / '+dsLabel+' = '+_ruv(pr.Mu_pos,'moment')+' / '+_ruv(pr.phi_Mn,'moment')+' = <b class="'+prV.cls+'">'+_rv(prDCR*100,1)+'%</b> '+prV.short+'</span>';
                }

                // ── 종합 판정 요약 ──
                h += '<hr style="margin:16px 0;border:none;border-top:2px solid var(--vscode-foreground);opacity:0.2">';
                h += '<h2>종합 판정</h2>';
                h += '<table><tr><th>구간</th><th>M<sub>u</sub></th><th>'+(dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;')+'</th><th>DCR</th><th>판정</th></tr>';
                // 부모멘트
                var negMuVal = _requiredMoment(d);
                var negV = _checkVerdict(d, 'F flexure', d.utilization);
                h += '<tr><td>부모멘트 (-M)</td><td>'+_ruv(negMuVal,'moment')+'</td><td>'+_ruv(d.design_strength,'moment')+'</td><td>'+_rv((d.utilization||0)*100,1)+'%</td><td class="'+negV.cls+'">'+negV.short+'</td></tr>';
                // 정모멘트
                if (pr.Mu_pos > 0) {
                    var prV2 = _v3(pr);
                    h += '<tr><td>정모멘트 (+M)</td><td>'+_ruv(pr.Mu_pos,'moment')+'</td><td>'+_ruv(pr.phi_Mn,'moment')+'</td><td>'+_rv((pr.utilization||0)*100,1)+'%</td><td class="'+prV2.cls+'">'+prV2.short+'</td></tr>';
                }
                h += '</table>';
                // 종합은 엔진의 전체 판정(H2·G5·미평가 포함)을 따른다.
                var overallV = _v3(d);
                h += '<span class="eq" style="font-size:14px">종합: <b class="'+overallV.cls+'">'+overallV.label+'</b></span>';
            }

            // ── Cold Work of Forming (§A3.3.2) ──
            if (d.cold_work && d.cold_work.applicable && d.Fy_used !== d.Fy_original) {
                h += '<h3>§A3.3.2 Cold Work of Forming</h3>';
                h += '<p>냉간가공에 의한 코너부 항복강도 증가를 고려합니다.</p>';
                var cw = d.cold_work;
                h += '<table><tr><th>항목</th><th>값</th></tr>';
                h += '<tr><td>F<sub>yv</sub> (virgin)</td><td>'+_rv(d.Fy_original)+' ksi</td></tr>';
                h += '<tr><td>F<sub>ya</sub> (cold work)</td><td>'+_rv(d.Fy_used)+' ksi (+'+cw.increase_pct+'%)</td></tr>';
                h += '<tr><td>Bc</td><td>'+_rv(cw.Bc,4)+'</td></tr>';
                h += '<tr><td>m</td><td>'+_rv(cw.m,4)+'</td></tr>';
                h += '<tr><td>C (코너면적비)</td><td>'+_rv(cw.C,4)+'</td></tr>';
                h += '<tr><td>R/t</td><td>'+_rv(cw.R_over_t,2)+'</td></tr>';
                h += '</table>';
            }

            // ── Lap Splice 접합부 결과 ──
            if (_lastLapResult && !_lastLapResult.error) {
                var lr = _lastLapResult;
                h += '<h3>Lap Splice 접합부 검토 (§I6.2.1, §J3/§J4)</h3>';
                h += '<p>연속 경간 지점의 Lap 구간에서 패스너 전단 전달과 2겹 부재 휨강도를 검토합니다.</p>';

                h += '<table><tr><th>항목</th><th>값</th><th>판정</th></tr>';
                // Lap 길이
                var lapL = lr.lap_left_in || (lr.steps && lr.steps[0] ? lr.steps[0].value : 0);
                h += '<tr><td>Lap 길이 (§I6.2.1(g))</td><td>' + _ruv(lapL, 'length') + ' ' + _rul('length') + '</td>';
                var _lapLenV = _v3(lr.lap_ok === true ? true : (lr.lap_ok === false ? false : null));
                h += '<td class="' + _lapLenV.cls + '">' + _lapLenV.short + ' (&ge; 1.5d = ' + _ruv(lr.min_lap, 'length') + ')</td></tr>';
                // 패스너
                h += '<tr><td>패스너</td><td>' + (lr.fastener_label || '') + ' &times; ' + lr.n_total + ' ea (' + lr.n_rows + ' rows &times; ' + lr.n_per_row + '/row)</td>';
                h += '<td>간격 s=' + _ruv(lr.spacing, 'length') + ' ' + _rul('length') + '</td></tr>';
                // 전단 전달
                h += '<tr><td>전달 전단력</td><td>' + _ruv(lr.V_transfer, 'force') + ' ' + _rul('force') + '</td><td></td></tr>';
                h += '<tr><td>패스너 용량</td><td>' + _ruv(lr.capacity, 'force') + ' ' + _rul('force') + '</td>';
                var _lrFastV = _ratioVerdict(lr.utilization, lr.pass === true);
                h += '<td class="' + _lrFastV.cls + '">DCR = ' + _rv(lr.utilization, 3) + ' ' + _lrFastV.short + '</td></tr>';
                // 휨강도
                if (lr.Mn_lap > 0) {
                    var _lrGovDcr = (lr.flexure_dcr_governing != null) ? lr.flexure_dcr_governing : lr.flexure_dcr;
                    h += '<tr><td>Lap 휨강도 (2겹 §F3/F4/H2)</td><td>' + _ruv(lr.phi_Mn_lap, 'moment') + ' ' + _rul('moment') + '</td>';
                    var _lrFlexV = _ratioVerdict(_lrGovDcr, lr.flexure_checked === true);
                    h += '<td class="' + _lrFlexV.cls + '">DCR = ' + _rv(_lrGovDcr, 3) + ' ' + _lrFlexV.short + '</td></tr>';
                }
                // 종합
                h += '<tr style="font-weight:700"><td>Lap 접합부 종합</td><td></td>';
                var _lrV = _v3(lr);
                h += '<td class="' + _lrV.cls + '">' + _lrV.label + '</td></tr>';
                h += '</table>';
                h += _verdictListsHtml(lr);
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

        function _rptCombined(d, _dm) {
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

        function _rptTension(d, _dm) {
            let h = '';
            h += '<h3>§D2 — 총단면 인장항복</h3>';
            h += '<span class="eq">T<sub>n</sub> = A<sub>g</sub> &times; F<sub>y</sub> = '+_ruv(d.Tn_yield,'force')+' '+_rul('force')+', &phi;<sub>t</sub>=0.90, &Omega;<sub>t</sub>=1.67</span>';
            h += '<h3>§D3 — 순단면 인장파단</h3>';
            if (d.Tn_rupture != null) {
                h += '<span class="eq">T<sub>n</sub> = A<sub>n</sub> &times; F<sub>u</sub> = '+_ruv(d.Tn_rupture,'force')+' '+_rul('force')+', &phi;<sub>t</sub>=0.75, &Omega;<sub>t</sub>=2.00</span>';
            } else {
                h += '<span class="eq warn">§D3 인장파단: 평가하지 못함 (F<sub>u</sub> 미입력) — 판정 없음</span>';
            }
            h += '<span class="eq">지배 모드: <b>'+(d.controlling_mode||'')+'</b>, 설계강도 = <b class="result">'+_ruv(d.design_strength,'force')+'</b> '+_rul('force')+'</span>';
            return h;
        }

        function _rptSummary(d, la) {
            const mt = d.member_type||'', dm = d.design_method||'LRFD';
            const mtNames = {flexure:'휨 부재 (보/퍼린)',compression:'압축 부재 (기둥/스터드)',combined:'축력+휨 조합 부재',tension:'인장 부재',connection:'접합부 (Chapter J)'};
            // 3상태 판정: utils.js 공통 verdictOf.
            const verdictOf = _v3;
            let h = '';

            // R2-04: 접합 검토에는 DSM 부재 문구를 쓰지 않는다.
            if (mt === 'connection') {
                h += '<p>본 보고서는 AISI S100-16 Chapter J에 의한 <b>접합부</b>의 설계 검토 결과입니다. ';
            } else {
                h += '<p>본 보고서는 AISI S100-16 직접강도법(DSM)에 의한 <b>'+(mtNames[mt]||mt)+'</b>의 설계 검토 결과입니다. ';
            }
            h += '설계 방법은 <b>'+dm+'</b>입니다. ';
            // V4-30: 퍼린 결과면 지배 구간의 조합(양력 구간이면 양력 조합)을.
            const _govCombo = (d && d.purlin_governing && d.purlin_governing.combo)
                || ((la && (la.governing || la.gravity)) || {}).combo || 'N/A';
            if (la) h += '부재는 <b>'+la.n_spans+'</b>경간이며, '+(d && d.purlin_governing ? '지배 구간('+_esc(_regionLabel(d.purlin_governing.label || ''))+')의 ' : '지배 ')+'하중조합은 <b>'+_esc(String(_govCombo))+'</b>입니다. ';
            h += '지배 파괴 모드는 <b>'+(d.controlling_mode||'N/A')+'</b>입니다.</p>';

            h += '<table>';
            h += '<tr><th style="width:50%">항목</th><th>값</th></tr>';
            h += '<tr><td>설계 기준</td><td>AISI S100-16</td></tr>';
            if (mt === 'connection') {
                h += '<tr><td>검토 방법</td><td>Chapter J 한계상태 검토</td></tr>';
            } else {
                h += '<tr><td>해석 방법</td><td>직접강도법 (DSM) — 유한스트립법</td></tr>';
            }
            h += '<tr><td>부재 유형</td><td>'+(mtNames[mt]||mt)+'</td></tr>';
            h += '<tr><td>설계 방법</td><td>'+dm+'</td></tr>';
            h += '<tr><td>지배 파괴 모드</td><td><b>'+(d.controlling_mode||'')+'</b></td></tr>';

            if (mt==='flexure') {
                var _dsLbl = dm==='LRFD'?'&phi;M<sub>n</sub>':'M<sub>n</sub>/&Omega;';
                // 부모멘트 구간
                if (d.positive_region) {
                    h += '<tr><td colspan="2" style="font-weight:700;background:rgba(255,152,0,0.08);border-left:3px solid #ff9800">부모멘트 구간 (-M)</td></tr>';
                }
                h += '<tr><td>M<sub>n</sub>(-)</td><td>'+_ruv(d.Mn,'moment')+' '+_rul('moment')+' <span style="color:var(--vscode-descriptionForeground)">'+(d.controlling_mode||'')+'</span></td></tr>';
                h += '<tr><td>'+_dsLbl+'(-)</td><td><b>'+_ruv(d.design_strength,'moment')+'</b> '+_rul('moment')+'</td></tr>';
                if (d.utilization != null) {
                    var _negPct = (d.utilization*100).toFixed(1);
                    var _negV = _checkVerdict(d, 'F flexure', d.utilization);
                    h += '<tr><td>DCR(-)</td><td class="'+_negV.cls+'"><b>'+_negPct+'% — '+_negV.short+'</b></td></tr>';
                }
                // 정모멘트 구간
                if (d.positive_region) {
                    var _pr2 = d.positive_region;
                    h += '<tr><td colspan="2" style="font-weight:700;background:rgba(76,175,80,0.08);border-left:3px solid #4caf50">정모멘트 구간 (+M)</td></tr>';
                    h += '<tr><td>M<sub>n</sub>(+)</td><td>'+_ruv(_pr2.Mn,'moment')+' '+_rul('moment')+'</td></tr>';
                    h += '<tr><td>'+_dsLbl+'(+)</td><td><b>'+_ruv(_pr2.phi_Mn,'moment')+'</b> '+_rul('moment')+'</td></tr>';
                    if (_pr2.utilization != null) {
                        var _posPct = (_pr2.utilization*100).toFixed(1);
                        var _posV = _v3(_pr2);
                        h += '<tr><td>DCR(+)</td><td class="'+_posV.cls+'"><b>'+_posPct+'% — '+_posV.short+'</b></td></tr>';
                    }
                }
            } else if (mt==='compression') {
                h += '<tr><td>공칭강도, P<sub>n</sub></td><td>'+_ruv(d.Pn,'force')+' '+_rul('force')+'</td></tr>';
                h += '<tr><td>설계강도, '+(dm==='LRFD'?'&phi;P<sub>n</sub>':'P<sub>n</sub>/&Omega;')+'</td><td><b>'+_ruv(d.design_strength,'force')+'</b> '+_rul('force')+'</td></tr>';
            } else {
                h += '<tr><td>설계강도</td><td><b>'+_rv(d.design_strength)+'</b></td></tr>';
            }

            if (mt === 'flexure' && d.positive_region) {
                // 종합 판정 (정+부 모두 반영)
                // 종합 판정은 엔진 전체 판정(정·부 구간, H2·G5, 미평가 포함)
                var _allV = verdictOf(d);
                h += '<tr><td colspan="2" style="font-weight:700;background:rgba(33,150,243,0.08);border-left:3px solid #2196f3">종합 판정</td></tr>';
                h += '<tr><td>종합 결과</td><td class="'+_allV.cls+'" style="font-size:14px"><b>'+_allV.label+'</b></td></tr>';
            } else if (d.utilization != null) {
                var pct = (d.utilization*100).toFixed(1);
                var v = verdictOf(d);
                h += '<tr><td>소요/저항 비율 (DCR)</td><td class="'+v.cls+'" style="font-size:14px"><b>'+pct+'% — '+v.short+'</b></td></tr>';
            } else {
                var v0 = verdictOf(d);
                h += '<tr><td>종합 판정</td><td class="'+v0.cls+'" style="font-size:14px"><b>'+v0.label+'</b></td></tr>';
            }
            if (d.governing_check) {
                h += '<tr><td>지배 검토</td><td>'+_esc(d.governing_check)+'</td></tr>';
            }
            if (Array.isArray(d.limit_state_checks) && d.limit_state_checks.length > 0) {
                d.limit_state_checks.forEach(c => {
                    var cv = verdictOf(c && typeof c === 'object' ? c : null);
                    h += '<tr><td>&nbsp;&nbsp;'+_esc(c && c.name)+'</td><td class="'+cv.cls+'">'+(c && typeof c.ratio === 'number' ? c.ratio.toFixed(3) : '—')+' — '+cv.short+'</td></tr>';
                });
            }
            if (d.purlin_mode && Array.isArray(d.purlin_regions)) {
                h += '<tr><td colspan="2" style="font-weight:700">퍼린 구간별 판정</td></tr>';
                d.purlin_regions.forEach(rg => {
                    var rr = rg && rg.result;
                    var rv = verdictOf(rr);
                    h += '<tr><td>&nbsp;&nbsp;'+_esc(_regionLabel(rg.label || rg.kind || ''))+'</td><td class="'+rv.cls+'">'
                        +(rr && typeof rr.utilization === 'number' ? (rr.utilization*100).toFixed(1)+'% — ' : '')
                        +(rr && rr.error ? '오류: '+_esc(rr.error) : rv.short)+'</td></tr>';
                });
            }
            if (d.interaction) {
                var iv = verdictOf(d.interaction);
                h += '<tr><td>조합 검토 (§H1.2)</td><td class="'+iv.cls+'"><b>'+_rv(d.interaction.total,4)+'</b> &le; 1.0 — '+iv.short+'</td></tr>';
            }
            h += '<tr><td>참조 규준 조항</td><td>'+(d.spec_sections||[]).join(', ')+'</td></tr>';
            h += '</table>';

            // 설계 경고 · 미평가 · 가정 · 적용 범위 (엔진 문장 그대로)
            h += _verdictListsHtml(d,
                Array.isArray(d.purlin_not_evaluated) ? d.purlin_not_evaluated : [],
                (d.dsm_warnings || []).concat(Array.isArray(d.purlin_warnings) ? d.purlin_warnings : []));
            // R2-04: 미검토 항목은 확정 판정 대신 필요 입력을 안내한다.
            if (verdictOf(d).state === 'NOT_CHECKED') {
                var ncNote = d.utilization == null
                    ? '소요값이 없어 판정하지 않았습니다(강도 조회).'
                    : '미평가 한계상태가 있어 전체 적합을 확정할 수 없습니다. 위 경고를 해소할 입력을 추가한 뒤 다시 검토하십시오.';
                h += '<div style="margin-top:8px;padding:6px;background:#fff3e0;border:1px solid #ff9800;border-radius:4px">';
                h += '<b style="color:#e65100">판정 없음 (미검토):</b> ' + ncNote + '</div>';
            }
            return h;
        }

        function _buildBucklingReportHtml() {
            const selT = document.getElementById('select-template');
            const secName = (selT && selT.selectedIndex >= 0) ? (selT.options[selT.selectedIndex].text || '직접 입력') : '직접 입력';
            const lc = document.getElementById('select-load-case');
            const lcName = (lc && lc.selectedIndex >= 0) ? lc.options[lc.selectedIndex].text : '';
            const bc = document.getElementById('select-bc')?.value || 'S-S';
            const uL = unitLabel('length');
            let h = '<h1>좌굴해석 결과 보고서 (FSM — Signature Curve)</h1>';
            h += '<h2>해석 조건</h2><table>';
            h += '<tr><th>항목</th><th>값</th></tr>';
            h += '<tr><td>단면</td><td>' + secName + ' (H=' + getNum('tpl-H', 0) + ', B=' + getNum('tpl-B', 0) + ', D=' + getNum('tpl-D', 0) + ', t=' + getNum('tpl-t', 0) + ' ' + uL + ')</td></tr>';
            h += '<tr><td>재료</td><td>Fy = ' + getNum('input-fy', 0) + ' ' + unitLabel('stress') + ', Fu = ' + getNum('input-fu', 0) + ' ' + unitLabel('stress') + '</td></tr>';
            h += '<tr><td>하중 케이스</td><td>' + lcName + '</td></tr>';
            h += '<tr><td>경계조건</td><td>' + bc + '</td></tr>';
            h += '<tr><td>반파장 범위</td><td>' + getNum('input-len-min', 0) + ' ~ ' + getNum('input-len-max', 0) + ' ' + uL + ' (' + getNum('input-len-n', 0) + '점)</td></tr>';
            h += '<tr><td>모델</td><td>' + (model && model.node ? model.node.length : 0) + ' 절점 / ' + (model && model.elem ? model.elem.length : 0) + ' 요소</td></tr>';
            h += '</table>';

            const dsmEl = document.getElementById('dsm-table-container');
            if (dsmEl && lastDsmResult) {
                h += '<h2>DSM 설계값</h2>' + dsmEl.innerHTML;
            }
            const charts = [
                ['buckling-curve-canvas', '좌굴 곡선 (Signature Curve)'],
                ['classify-curve-canvas', '모드 분류 (G/D/L/O)'],
                ['mode-shape-canvas', '모드 형상 (2D)'],
                ['mode-shape-3d-canvas', '모드 형상 (3D)'],
                ['plastic-surface-canvas', '소성 상호작용 곡면'],
            ];
            charts.forEach(pair => {
                const png = _canvasPng(pair[0]);
                if (png) { h += '<h2>' + pair[1] + '</h2><div class="chart"><img src="' + png + '"></div>'; }
            });
            h += '<p style="font-size:10px;opacity:0.6;margin-top:16px">StCFSD — CUFSM 기반 유한스트립 좌굴해석. 차트는 해석 시점의 화면 렌더링을 캡처한 것입니다.</p>';
            return h;
        }

        /**
         * K3-5: 화면 없이 만든 좌굴 보고서 — 캔버스 그림은 화면에서만 나온다. 그림 대신 서명곡선(SVG)과 DSM 값 표(상세 보고서의 같은 절)를
         * 넣고, 화면 없이 만들었다고 보고서 안에 적는다(결정 5).
         */
        function buildBucklingReportHeadless() {
            const h = _buildBucklingReportHtml();
            const foot = '<p style="font-size:10px;opacity:0.6;margin-top:16px">';
            const at = h.lastIndexOf(foot);
            const note = '<p style="font-size:11px;margin-top:12px;padding:6px 8px;border-left:3px solid #ff9800">화면 없이 만든 보고서입니다 — 그림은 서명곡선(SVG)만 넣었습니다. 모드 형상 · 분류 · 소성 곡면 그림은 화면이 열려 있을 때 만든 보고서에 들어갑니다.</p>';
            const body = '<h2>서명곡선 · DSM 값</h2>' + _rptBuckling() + note;
            return at >= 0 ? h.slice(0, at) + body + h.slice(at) : h + body;
        }

        function _statusFromVerdict(v, ratio) {
            if (v.state === 'FAIL') { return 'fail'; }
            if (v.state !== 'PASS') { return 'warn'; }
            return (typeof ratio === 'number' && ratio > 0.95) ? 'warn' : 'pass';
        }

        return {
            runAllValidationChecks, renderValidationDashboard, generateDetailedReport,
            buildBucklingReportHtml: _buildBucklingReportHtml, buildBucklingReportHeadless,
            renderBeamSchematic, renderDiagramSVG,
        };
    }

    /**
     * 검증 항목의 고정 id(K3 결정 10) — 표 하나. [id, 화면 이름(한글 — 표시 이름), 번호가 붙는 이름이면 그 앞부분]. 이름은 지금 화면의 글 그대로.
     * 번호가 붙는 항목(스팬 · 지점 · 경고 #)은 id 뒤에 「.<번호>」.
     */
    const VALIDATION_IDS = [
        ['val.section.defined', '단면 정의'], ['val.section.thickness', '두께 (t)'], ['val.section.web_wt', '웹 w/t 비'],
        ['val.section.flange_bt', '플랜지 b/t 비'], ['val.section.lip_dt', '립 d/t 비'], ['val.section.corner_rt', '코너 R/t 비'],
        ['val.material.fy', '항복강도 (Fy)'], ['val.material.fu_fy', 'Fu/Fy 비'], ['val.material.fu', '인장강도 (Fu)'],
        ['val.buckling.length_min', '반파장 최솟값'], ['val.buckling.length_max', '반파장 최댓값'], ['val.buckling.length_count', '반파장 개수'],
        ['val.buckling.bc', '경계조건 (BC)'], ['val.buckling.load_case', 'Load Case 적합성'], ['val.buckling.analysis_run', '해석 실행 여부'],
        ['val.buckling.dsm_extracted', 'DSM 값 추출'], ['val.buckling.mcrl', 'Mcrl 식별 (국부좌굴)'], ['val.buckling.mcrd', 'Mcrd 식별 (뒤틀림좌굴)'],
        ['val.props.computed', '성질 계산 여부'], ['val.props.sx', '단면계수 Sx'], ['val.props.r', '회전반경 rx, rz'],
        ['val.loads.span', '스팬 길이'], ['val.loads.spacing', '분담폭 (간격)'], ['val.loads.dead', '고정하중 (D)'],
        ['val.loads.gravity_live', '중력 활하중/적설하중'], ['val.loads.wind', '풍하중 (W, 양력)'],
        ['val.load_analysis.run', '하중 분석 실행 여부'], ['val.load_analysis.max_mu', '최대 Mu'], ['val.load_analysis.vu', '전단력 (Vu)'],
        ['val.load_analysis.ly_negative', '비지지 길이 Ly (부모멘트)'], ['val.load_analysis.cb_negative', '모멘트 구배 Cb'],
        ['val.load_analysis.uplift_r', '양력 R 계수 (§I6.2.1)'], ['val.load_analysis.ly_positive', '비지지 길이 Ly(+) (정모멘트)'],
        ['val.load_analysis.cb_positive', '모멘트 구배 Cb(+)'], ['val.load_analysis.positive_braced', '정모멘트 구간 구속'],
        ['val.load_analysis.lap_end_mu', 'Lap 끝단 Mu 추출'], ['val.load_analysis.deflection_span', '처짐 — 스팬 ', true],
        ['val.load_analysis.deflection', '처짐 검토'],
        ['val.design.run', '설계 검토 실행 여부'], ['val.design.overall', '종합 판정 (엔진)'], ['val.design.mne_my', 'Mne vs My'],
        ['val.design.inelastic_reserve', '§F2.4.2 Inelastic Reserve'], ['val.design.uplift_r', '§I6.2.1 R-factor (양력)'],
        ['val.design.cold_work', '§A3.3.2 Cold Work (냉간가공)'], ['val.design.cold_work_ir', '§A3.3.2 ↔ §F2.4.2 배타 관계'],
        ['val.design.mnl_mne', 'Mnl vs Mne (국부좌굴 감소)'], ['val.design.mnd_my', 'Mnd vs My (뒤틀림좌굴 감소)'],
        ['val.design.all_mn_equal', '모든 Mn 동일 (잠재적 문제)'], ['val.design.positive_phimn', '정모멘트 φMn(+)'],
        ['val.design.positive_ltb', '정모멘트 LTB'], ['val.design.pnl_pne', 'Pnl vs Pne (국부좌굴 감소)'], ['val.design.pnd_py', 'Pnd vs Py (뒤틀림좌굴 감소)'],
        ['val.design.util_negative', '이용률 — 부모멘트 (-M)'], ['val.design.lb_cb_negative', 'Lb(-) / Cb(-) (부모멘트)'],
        ['val.design.utilization', '이용률 (DCR)'], ['val.design.util_positive', '이용률 — 정모멘트 (+M)'],
        ['val.design.lb_cb_positive', 'Lb(+) / Cb(+) (정모멘트)'], ['val.design.phi', '저항계수 (φ)'], ['val.design.interaction', '조합 검토 (§H1.2)'],
        ['val.design.dsm_warning', 'DSM 경고 #', true], ['val.design.fallback', '뒤틀림좌굴 해석적 Fallback'], ['val.design.warning', '설계 경고 #', true],
        ['val.design.dsm_extract_warning', 'DSM 추출 경고'],
        ['val.lap.flexure', 'Lap 구간 휨강도 (§F3, 2겹)'], ['val.lap.length', 'Lap 길이 (지점 ', true], ['val.lap.fastener', 'Lap 패스너 전단 (DCR)'],
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
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CUFSM Design Report</title>
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

    return { UNIT, make, VALIDATION_IDS, validationId, withIds, printableReportHtml, composeReport };
}));
