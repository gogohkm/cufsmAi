/**
 * Babylon.js 3D 뷰어 — WebView 번들 진입점
 *
 * webpack으로 번들되어 media/viewer3d.js로 출력된다.
 * webview에서 <script src="viewer3d.js"> 로 로드 후
 * window.CufsmViewer3D 로 접근한다.
 */

import { ModeShape3DRenderer, ModeShape3DData } from './ModeShape3DRenderer';
import { PlasticSurfaceRenderer, PlasticSurfaceData } from './PlasticSurfaceRenderer';

// 전역 노출
(window as any).CufsmViewer3D = {
    ModeShape3DRenderer,
    PlasticSurfaceRenderer,
    _modeInstance: null as ModeShape3DRenderer | null,
    _plasticInstance: null as PlasticSurfaceRenderer | null,

    /** 3D 모드형상 렌더러 초기화 */
    init(canvasId: string): ModeShape3DRenderer {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!canvas) { throw new Error(`Canvas '${canvasId}' not found`); }
        const renderer = new ModeShape3DRenderer(canvas);
        renderer.init();
        (window as any).CufsmViewer3D._modeInstance = renderer;
        return renderer;
    },

    /** 모드형상 렌더링 */
    render(data: ModeShape3DData): void {
        let inst = (window as any).CufsmViewer3D._modeInstance;
        if (!inst) {
            inst = (window as any).CufsmViewer3D.init('mode-shape-3d-canvas');
        }
        inst.render(data);
    },

    /** 소성곡면 렌더러 초기화 */
    initPlastic(canvasId: string): PlasticSurfaceRenderer {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!canvas) { throw new Error(`Canvas '${canvasId}' not found`); }
        const renderer = new PlasticSurfaceRenderer(canvas);
        renderer.init();
        (window as any).CufsmViewer3D._plasticInstance = renderer;
        return renderer;
    },

    /** 소성곡면 렌더링 */
    renderPlastic(data: PlasticSurfaceData): void {
        let inst = (window as any).CufsmViewer3D._plasticInstance;
        if (!inst) {
            inst = (window as any).CufsmViewer3D.initPlastic('plastic-surface-canvas');
        }
        inst.render(data);
    },
};
