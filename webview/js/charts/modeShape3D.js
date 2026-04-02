/**
 * 3D 모드형상 렌더링 (Babylon.js)
 *
 * 참조: 컨버전전략.md §7.3 — dispshp2.m → Babylon.js
 * 참조: 컨버전전략.md §15 — stgen CameraController/MaterialCache 패턴 재활용
 *
 * Babylon.js는 webpack으로 번들하지 않고, ESM CDN에서 로드합니다.
 * CSP에 의해 직접 import가 불가하므로, 경량 WebGL 직접 구현으로 대체합니다.
 *
 * 이 모듈은 순수 Canvas WebGL로 3D 모드형상을 렌더링합니다.
 * Babylon.js 전환은 webpack 번들링 구조 완성 시 수행합니다.
 */

/**
 * 3D 모드형상 렌더링 (Canvas 2D 기반 와이어프레임)
 *
 * 변형된 단면을 길이방향으로 배치하여 3D 효과를 만듭니다.
 * 간단한 등각투영(isometric) 뷰로 표현합니다.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number[][]} nodes - [[node#, x, z, ...], ...]
 * @param {number[][]} elems - [[elem#, ni, nj, t, mat], ...]
 * @param {number[]} modeVec - 모드형상 벡터 (ndof)
 * @param {number} length - 부재 길이 (half-wavelength)
 * @param {string} BC - 경계조건
 */
function renderModeShape3D(canvas, nodes, elems, modeVec, length, BC) {
    const ctx = canvas.getContext('2d');
    if (!ctx) { return; }

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!nodes || !elems || !modeVec || nodes.length === 0) {
        const style = getComputedStyle(document.body);
        ctx.fillStyle = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';
        ctx.font = '13px sans-serif';
        ctx.fillText('No 3D mode shape data', 20, 30);
        return;
    }

    const nnodes = nodes.length;
    const skip = 2 * nnodes;
    const dispScale = 0.3; // 변위 스케일

    // 단면 좌표 범위
    const xs = nodes.map(n => n[1]);
    const zs = nodes.map(n => n[2]);
    const xRange = Math.max(...xs) - Math.min(...xs) || 1;
    const zRange = Math.max(...zs) - Math.min(...zs) || 1;
    const sectionSize = Math.max(xRange, zRange);

    // 등각투영 변환 파라미터
    const isoAngle = Math.PI / 6; // 30도
    const cosA = Math.cos(isoAngle);
    const sinA = Math.sin(isoAngle);

    // 스케일 계산
    const totalSpan = sectionSize + length * sinA;
    const scale = (Math.min(w, h) - 80) / totalSpan;
    const cx = w / 2;
    const cy = h / 2 + length * sinA * scale * 0.2;

    // 경계조건에 따른 형상함수
    function shapeFunc(y) {
        const ya = y / length;
        if (BC === 'S-S') { return Math.sin(Math.PI * ya); }
        if (BC === 'C-C') { return Math.sin(Math.PI * ya) * Math.sin(Math.PI * ya); }
        if (BC === 'C-F') { return 1 - Math.cos(Math.PI * ya / 2); }
        return Math.sin(Math.PI * ya);
    }

    // 2D → isometric 변환
    function toIso(x, y, z) {
        const ix = (x - z) * cosA * scale + cx;
        const iy = -(x + z) * sinA * scale - y * scale + cy;
        return [ix, iy];
    }

    // 종방향 스텝
    const nSteps = 16;
    const style = getComputedStyle(document.body);
    const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#ccc';

    // 각 변위 추출
    const uDisp = []; // 면내
    const wDisp = []; // 면외
    for (let n = 0; n < nnodes; n++) {
        uDisp.push((modeVec[2 * n] || 0) * dispScale * sectionSize);
        wDisp.push((modeVec[skip + 2 * n] || 0) * dispScale * sectionSize);
    }

    // 요소별 절점 쌍
    const elemPairs = [];
    elems.forEach(e => {
        const ni = e[1] - 1; // 1-based → 0-based
        const nj = e[2] - 1;
        if (ni >= 0 && ni < nnodes && nj >= 0 && nj < nnodes) {
            elemPairs.push([ni, nj]);
        }
    });

    // === 미변형 단면 (뒤쪽 → 앞쪽 순서로 그려서 깊이감 표현) ===
    for (let s = 0; s <= nSteps; s++) {
        const y = (s / nSteps) * length;
        const Ym = shapeFunc(y);
        const alpha = s / nSteps; // 깊이 기반 투명도

        // 미변형 (회색, 반투명)
        ctx.strokeStyle = fg;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.1 + alpha * 0.1;
        elemPairs.forEach(([ni, nj]) => {
            const [x1, y1] = toIso(xs[ni], y, zs[ni]);
            const [x2, y2] = toIso(xs[nj], y, zs[nj]);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });

        // 변형 (파란색)
        ctx.globalAlpha = 0.3 + alpha * 0.5;
        elemPairs.forEach(([ni, nj]) => {
            const dx_i = uDisp[ni] * Ym;
            const dz_i = wDisp[ni] * Ym;
            const dx_j = uDisp[nj] * Ym;
            const dz_j = wDisp[nj] * Ym;

            const [x1, y1] = toIso(xs[ni] + dx_i, y, zs[ni] + dz_i);
            const [x2, y2] = toIso(xs[nj] + dx_j, y, zs[nj] + dz_j);

            // 변위 크기에 따른 색상
            const mag_i = Math.sqrt(dx_i * dx_i + dz_i * dz_i);
            const mag_j = Math.sqrt(dx_j * dx_j + dz_j * dz_j);
            const maxMag = Math.max(...uDisp.map(Math.abs), ...wDisp.map(Math.abs)) * 1.0 || 1;
            const t = (mag_i + mag_j) / 2 / maxMag;

            // 파랑(작은 변위) → 빨강(큰 변위) 그라디언트
            const r = Math.floor(50 + t * 205);
            const g = Math.floor(150 * (1 - t));
            const b = Math.floor(247 * (1 - t));
            ctx.strokeStyle = `rgb(${r},${g},${b})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        });
    }
    ctx.globalAlpha = 1.0;

    // 길이방향 연결선 (변형 단면 윤곽 추적)
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.2)';
    ctx.lineWidth = 0.5;
    for (let n = 0; n < nnodes; n++) {
        ctx.beginPath();
        for (let s = 0; s <= nSteps; s++) {
            const y = (s / nSteps) * length;
            const Ym = shapeFunc(y);
            const dx = uDisp[n] * Ym;
            const dz = wDisp[n] * Ym;
            const [px, py] = toIso(xs[n] + dx, y, zs[n] + dz);
            s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
    }

    // 라벨
    ctx.fillStyle = fg;
    ctx.font = '11px sans-serif';
    ctx.globalAlpha = 0.7;
    ctx.fillText(`L = ${length.toFixed(1)}  |  BC: ${BC}`, 10, h - 10);
    ctx.globalAlpha = 1.0;
}

// 전역 노출
if (typeof window !== 'undefined') {
    window.renderModeShape3D = renderModeShape3D;
}
