/**
 * Babylon.js 3D 뷰어 — WebView 번들 진입점
 *
 * webpack으로 번들되어 media/viewer3d.js로 출력된다.
 * webview에서 <script src="viewer3d.js"> 로 로드 후
 * window.CufsmViewer3D 로 접근한다.
 */

import type { ModeShape3DData, ModeShape3DRenderer } from './ModeShape3DRenderer';

declare let __webpack_nonce__: string;

// Webpack이 생성하는 지연 로딩 <script>에도 VS Code WebView CSP nonce를 전달한다.
const currentScriptNonce = document.currentScript?.nonce;
if (currentScriptNonce) {
    __webpack_nonce__ = currentScriptNonce;
}

type ViewerApi = {
    _modeInstance: ModeShape3DRenderer | null;
    _modeInitPromise: Promise<ModeShape3DRenderer> | null;
    init(canvasId: string): Promise<ModeShape3DRenderer>;
    render(data: ModeShape3DData): Promise<void>;
};

// 전역 노출
(window as any).CufsmViewer3D = {
    _modeInstance: null as ModeShape3DRenderer | null,
    _modeInitPromise: null as Promise<ModeShape3DRenderer> | null,

    /** 3D 모드형상 렌더러를 최초 사용 시에만 로드하고 초기화한다. */
    async init(canvasId: string): Promise<ModeShape3DRenderer> {
        const api = (window as any).CufsmViewer3D as ViewerApi;
        if (api._modeInstance) { return api._modeInstance; }
        if (api._modeInitPromise) { return api._modeInitPromise; }

        api._modeInitPromise = import(
            /* webpackChunkName: "mode-shape-renderer" */ './ModeShape3DRenderer'
        ).then(({ ModeShape3DRenderer }) => {
            const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
            if (!canvas) { throw new Error(`Canvas '${canvasId}' not found`); }
            const renderer = new ModeShape3DRenderer(canvas);
            renderer.init();
            api._modeInstance = renderer;
            return renderer;
        }).catch((error: unknown) => {
            api._modeInitPromise = null;
            throw error;
        });

        return api._modeInitPromise;
    },

    /** 모드형상 렌더링 */
    async render(data: ModeShape3DData): Promise<void> {
        const api = (window as any).CufsmViewer3D as ViewerApi;
        const inst = api._modeInstance ?? await api.init('mode-shape-3d-canvas');
        inst.render(data);
    },
} satisfies ViewerApi;
