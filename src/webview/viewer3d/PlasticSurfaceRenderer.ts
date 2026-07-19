/**
 * Babylon.js 3D 소성곡면 렌더러 (P-M11-M22)
 *
 * 참조: 프로젝트개요.md §5.4 소성 해석
 * 참조: 컨버전전략.md §7 시각화 — PMMplotter.m → Babylon.js
 *
 * Python plastic 해석이 반환하는 주축 P-M11-M22 상호작용 곡면을 표시한다.
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import { createVertexColorMaterial } from "./vertexColorMaterial";

export interface PlasticSurfaceData {
    P: number[];
    M11: number[];
    M22: number[];
}

export class PlasticSurfaceRenderer {
    private _engine: Engine | null = null;
    private _scene: Scene | null = null;
    private _camera: FreeCamera | null = null;
    private _canvas: HTMLCanvasElement;
    private _meshes: Mesh[] = [];

    private _isDragging = false;
    private _lastMouseX = 0;
    private _lastMouseY = 0;
    private _rotX = -0.7;
    private _rotY = 0.5;
    private _distance = 3;
    private _resizeObserver: ResizeObserver | null = null;
    private _inputAbort: AbortController | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this._canvas = canvas;
    }

    init(): void {
        if (this._engine) { return; }

        this._engine = new Engine(this._canvas, true, { stencil: false } as any);
        this._scene = new Scene(this._engine);
        this._scene.useRightHandedSystem = true;
        this._scene.clearColor = new Color4(0.12, 0.12, 0.12, 1);

        this._camera = new FreeCamera("cam", Vector3.Zero(), this._scene);
        this._camera.minZ = 0.001;
        this._camera.maxZ = 100;
        this._camera.detachControl();

        this._setupMouseControls();

        this._engine.runRenderLoop(() => {
            this._updateCamera();
            this._scene!.render();
        });

        this._resizeObserver = new ResizeObserver(() => this._engine?.resize());
        this._resizeObserver.observe(this._canvas);
    }

    render(data: PlasticSurfaceData): void {
        if (!this._scene) { this.init(); }
        this._clearMeshes();

        const { P, M11, M22 } = data;
        const n = P.length;
        if (n < 3) { return; }

        // 정규화
        const pMax = Math.max(...P.map(Math.abs)) || 1;
        const m11Max = Math.max(...M11.map(Math.abs)) || 1;
        const m22Max = Math.max(...M22.map(Math.abs)) || 1;

        // 점들을 3D 좌표로 변환
        const positions: number[] = [];
        const colors: number[] = [];

        for (let i = 0; i < n; i++) {
            const x = M22[i] / m22Max;
            const y = P[i] / pMax;
            const z = M11[i] / m11Max;
            positions.push(x, y, z);

            // 색상: P 양이면 빨강, 음이면 파랑
            const t = (y + 1) / 2;
            colors.push(t, 0.2, 1 - t, 0.8);
        }

        // Delaunay-like 삼각화 (theta-phi 그리드 기반)
        // pmm_plastic이 theta×phi 그리드로 생성하므로 그리드 삼각화
        const indices: number[] = [];
        // n_theta × (n_phi+1) 격자 추정
        // 간단히: convex hull 근사로 인접 점 연결
        _buildTriangulation(positions, indices, n);

        if (indices.length >= 3) {
            const mesh = new Mesh("surface", this._scene!);
            const vertexData = new VertexData();
            vertexData.positions = positions;
            vertexData.indices = indices;
            vertexData.colors = colors;
            vertexData.applyToMesh(mesh);

            mesh.material = createVertexColorMaterial("plasticSurfaceMaterial", this._scene!, 0.7);
            mesh.hasVertexAlpha = true;
            this._meshes.push(mesh);
        }

        // 축 라인
        this._addAxisLines();

        this._distance = 3;
    }

    private _addAxisLines(): void {
        const axisLen = 1.3;
        const axisColors = [
            { dir: [axisLen, 0, 0], color: new Color3(1, 0.3, 0.3) },  // M22 (X)
            { dir: [0, axisLen, 0], color: new Color3(0.3, 1, 0.3) },  // P (Y)
            { dir: [0, 0, axisLen], color: new Color3(0.3, 0.3, 1) },  // M11 (Z)
        ];

        for (const axis of axisColors) {
            const [dx, dy, dz] = axis.dir;
            const points = [
                new Vector3(-dx, -dy, -dz),
                new Vector3(dx, dy, dz),
            ];
            const line = CreateLines(`axis`, { points }, this._scene!);
            line.color = axis.color;
            this._meshes.push(line);
        }
    }

    private _clearMeshes(): void {
        for (const m of this._meshes) { m.dispose(false, true); }
        this._meshes = [];
    }

    private _updateCamera(): void {
        if (!this._camera) { return; }
        const x = this._distance * Math.cos(this._rotY) * Math.sin(this._rotX);
        const y = this._distance * Math.sin(this._rotY);
        const z = this._distance * Math.cos(this._rotY) * Math.cos(this._rotX);
        this._camera.position = new Vector3(x, y, z);
        this._camera.setTarget(Vector3.Zero());
    }

    private _setupMouseControls(): void {
        this._inputAbort?.abort();
        this._inputAbort = new AbortController();
        const signal = this._inputAbort.signal;

        this._canvas.addEventListener('pointerdown', (e: PointerEvent) => {
            this._isDragging = true;
            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;
        }, { signal });
        this._canvas.addEventListener('pointermove', (e: PointerEvent) => {
            if (!this._isDragging) { return; }
            this._rotX += (e.clientX - this._lastMouseX) * 0.01;
            this._rotY = Math.max(-1.5, Math.min(1.5,
                this._rotY + (e.clientY - this._lastMouseY) * 0.01));
            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;
        }, { signal });
        this._canvas.addEventListener('pointerup', () => { this._isDragging = false; }, { signal });
        this._canvas.addEventListener('pointerleave', () => { this._isDragging = false; }, { signal });
        this._canvas.addEventListener('wheel', (e: WheelEvent) => {
            this._distance *= e.deltaY > 0 ? 1.1 : 0.9;
            this._distance = Math.max(0.5, Math.min(50, this._distance));
            e.preventDefault();
        }, { signal });
    }

    dispose(): void {
        this._inputAbort?.abort();
        this._inputAbort = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._clearMeshes();
        this._scene?.dispose();
        this._engine?.dispose();
        this._camera = null;
        this._scene = null;
        this._engine = null;
    }
}

/** 점 배열에서 삼각형 인덱스 생성 (그리드 기반 근사) */
function _buildTriangulation(positions: number[], indices: number[], n: number): void {
    // theta×phi 그리드 추정 — n = n_theta * (n_phi + 1)
    // n_phi+1 단위로 행 구분
    let nPhi = 0;
    for (let p = 2; p < 50; p++) {
        if (n % p === 0) {
            nPhi = p;
            break;
        }
    }
    if (nPhi < 2) { nPhi = Math.floor(Math.sqrt(n)); }
    const nTheta = Math.floor(n / nPhi);
    if (nTheta < 2 || nPhi < 2) { return; }

    for (let t = 0; t < nTheta - 1; t++) {
        for (let p = 0; p < nPhi - 1; p++) {
            const a = t * nPhi + p;
            const b = a + 1;
            const c = (t + 1) * nPhi + p;
            const d = c + 1;
            if (a < n && b < n && c < n && d < n) {
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }
    }
}
