// StcfsdUtils — DOM 무의존 순수 유틸 (app.js에서 분리, 0926 후속-1).
// UMD: 브라우저에서는 globalThis.StcfsdUtils, node 테스트에서는 require.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
        return;
    }
    root.StcfsdUtils = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    // 숫자 포맷: 비숫자 '-', 미소값 지수, 나머지 소수 4자리
    function fmt(v) {
        if (typeof v !== 'number') { return '-'; }
        return Math.abs(v) < 0.01 ? v.toExponential(3) : v.toFixed(4);
    }

    // 로그 간격 수열 (반파장 범위 생성용)
    function logspace(a, b, n) {
        const arr = [];
        for (let i = 0; i < n; i++) {
            arr.push(Math.pow(10, a + (b - a) * i / (n - 1)));
        }
        return arr;
    }

    // 볼록껍질 (Andrew monotone chain) — 소성 곡면 P-M 도표용
    function convexHull(points) {
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

    return { fmt, logspace, convexHull };
});
