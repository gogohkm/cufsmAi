/**
 * Babylon.js 3D 뷰어 — WebView 번들 진입점
 *
 * webpack으로 번들되어 media/viewer3d.js로 출력된다.
 * webview에서 <script src="viewer3d.js"> 로 로드 후
 * window.CufsmViewer3D 로 접근한다.
 */

import { ModeShape3DRenderer, ModeShape3DData } from './ModeShape3DRenderer';

// 전역 노출
(window as any).CufsmViewer3D = {
    ModeShape3DRenderer,
    _instance: null as ModeShape3DRenderer | null,

    /** 3D 렌더러 초기화 (canvas ID) */
    init(canvasId: string): ModeShape3DRenderer {
        const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
        if (!canvas) {
            throw new Error(`Canvas element '${canvasId}' not found`);
        }
        const renderer = new ModeShape3DRenderer(canvas);
        renderer.init();
        (window as any).CufsmViewer3D._instance = renderer;
        return renderer;
    },

    /** 현재 인스턴스로 렌더링 */
    render(data: ModeShape3DData): void {
        let inst = (window as any).CufsmViewer3D._instance;
        if (!inst) {
            inst = (window as any).CufsmViewer3D.init('mode-shape-3d-canvas');
        }
        inst.render(data);
    }
};
