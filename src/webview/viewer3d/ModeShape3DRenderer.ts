/**
 * Babylon.js 3D 모드형상 렌더러
 *
 * 참조: 컨버전전략.md §7.3, §15 stgen 재활용 패턴
 *
 * stgen dxfRenderer.ts 패턴:
 * - Engine + Scene 초기화
 * - useRightHandedSystem (구조공학 좌표계)
 * - FreeCamera (직교/원근 전환)
 * - StandardMaterial + backFaceCulling: false
 */

import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";

// side-effect imports for mesh builders
import "@babylonjs/core/Meshes/Builders/linesBuilder";

export interface ModeShape3DData {
    nodes: number[][];    // [[node#, x, z, ...], ...]
    elems: number[][];    // [[elem#, ni, nj, t, mat], ...]
    modeVec: number[];    // 모드형상 벡터
    length: number;       // 부재 길이
    BC: string;           // 경계조건
    scale?: number;       // 변위 스케일
}

export class ModeShape3DRenderer {
    private _engine: Engine | null = null;
    private _scene: Scene | null = null;
    private _camera: FreeCamera | null = null;
    private _canvas: HTMLCanvasElement;
    private _mesh: Mesh | null = null;
    private _wireframes: Mesh[] = [];

    // 마우스 회전 상태
    private _isDragging = false;
    private _lastMouseX = 0;
    private _lastMouseY = 0;
    private _rotX = -0.5;
    private _rotY = 0.4;
    private _distance = 30;

    constructor(canvas: HTMLCanvasElement) {
        this._canvas = canvas;
    }

    init(): void {
        if (this._engine) { return; }

        // stgen 패턴: Engine 옵션
        this._engine = new Engine(this._canvas, true, {
            stencil: false,
        } as any);

        this._scene = new Scene(this._engine);
        this._scene.useRightHandedSystem = true;
        this._scene.clearColor = new Color4(0.12, 0.12, 0.12, 1);

        // 카메라
        this._camera = new FreeCamera("cam", new Vector3(0, 0, 0), this._scene);
        this._camera.minZ = 0.01;
        this._camera.maxZ = 10000;
        this._camera.detachControl();

        // 조명
        const light = new HemisphericLight("light", new Vector3(0, 1, 0.5), this._scene);
        light.intensity = 0.9;

        // 마우스 인터랙션
        this._setupMouseControls();

        // 렌더 루프
        this._engine.runRenderLoop(() => {
            this._updateCamera();
            this._scene!.render();
        });

        // 리사이즈
        const resizeObs = new ResizeObserver(() => this._engine?.resize());
        resizeObs.observe(this._canvas);
    }

    render(data: ModeShape3DData): void {
        if (!this._scene) { this.init(); }

        // 기존 메시 제거
        this._clearMeshes();

        const { nodes, elems, modeVec, length, BC } = data;
        const dispScale = data.scale || 0.3;
        const nnodes = nodes.length;
        const skip = 2 * nnodes;
        const nSteps = 20;

        // 단면 크기 계산
        const xs = nodes.map(n => n[1]);
        const zs = nodes.map(n => n[2]);
        const xMid = (Math.min(...xs) + Math.max(...xs)) / 2;
        const zMid = (Math.min(...zs) + Math.max(...zs)) / 2;
        const sectionSize = Math.max(
            Math.max(...xs) - Math.min(...xs),
            Math.max(...zs) - Math.min(...zs)
        ) || 1;

        this._distance = Math.max(sectionSize * 2, length * 0.8);

        // 변위 추출
        const uDisp: number[] = [];
        const wDisp: number[] = [];
        for (let n = 0; n < nnodes; n++) {
            uDisp.push((modeVec[2 * n] || 0) * dispScale * sectionSize);
            wDisp.push((modeVec[skip + 2 * n] || 0) * dispScale * sectionSize);
        }

        // 요소 쌍
        const elemPairs: [number, number][] = [];
        for (const e of elems) {
            const ni = e[1] - 1;
            const nj = e[2] - 1;
            if (ni >= 0 && ni < nnodes && nj >= 0 && nj < nnodes) {
                elemPairs.push([ni, nj]);
            }
        }

        // 형상함수
        const shapeFunc = (y: number): number => {
            const ya = y / length;
            if (BC === 'C-C') { return Math.sin(Math.PI * ya) ** 2; }
            if (BC === 'C-F') { return 1 - Math.cos(Math.PI * ya / 2); }
            if (BC === 'S-C') { return Math.sin(Math.PI * ya) + ya * Math.sin(2 * Math.PI * ya) / (1 + ya); }
            return Math.sin(Math.PI * ya); // S-S default
        };

        // === 변형 메시 (면) ===
        const positions: number[] = [];
        const indices: number[] = [];
        const colors: number[] = [];
        const maxDisp = Math.max(
            ...uDisp.map(Math.abs),
            ...wDisp.map(Math.abs)
        ) || 1;

        // 각 요소에 대해 길이방향 메시 생성
        for (const [ni, nj] of elemPairs) {
            const baseIdx = positions.length / 3;

            for (let s = 0; s <= nSteps; s++) {
                const y = (s / nSteps) * length;
                const Ym = shapeFunc(y);

                // 절점 i
                const dxi = uDisp[ni] * Ym;
                const dzi = wDisp[ni] * Ym;
                positions.push(
                    xs[ni] + dxi - xMid,
                    y - length / 2,
                    zs[ni] + dzi - zMid
                );

                // 절점 j
                const dxj = uDisp[nj] * Ym;
                const dzj = wDisp[nj] * Ym;
                positions.push(
                    xs[nj] + dxj - xMid,
                    y - length / 2,
                    zs[nj] + dzj - zMid
                );

                // 색상: 변위 크기 → 파랑(0)→빨강(1)
                const magI = Math.sqrt(dxi * dxi + dzi * dzi) / maxDisp;
                const magJ = Math.sqrt(dxj * dxj + dzj * dzj) / maxDisp;
                colors.push(magI, 0.3 * (1 - magI), 1 - magI, 1);
                colors.push(magJ, 0.3 * (1 - magJ), 1 - magJ, 1);
            }

            // 삼각형 인덱스
            for (let s = 0; s < nSteps; s++) {
                const a = baseIdx + s * 2;
                const b = a + 1;
                const c = a + 2;
                const d = a + 3;
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        // Babylon.js 메시 생성
        const mesh = new Mesh("modeShape", this._scene!);
        const vertexData = new VertexData();
        vertexData.positions = positions;
        vertexData.indices = indices;
        vertexData.colors = colors;
        vertexData.applyToMesh(mesh);

        const mat = new StandardMaterial("mat", this._scene!);
        mat.backFaceCulling = false;
        mat.emissiveColor = new Color3(0.4, 0.4, 0.4);
        mat.alpha = 0.85;
        mesh.material = mat;
        mesh.hasVertexAlpha = true;
        this._mesh = mesh;

        // === 미변형 와이어프레임 ===
        for (const [ni, nj] of elemPairs) {
            const linePoints: Vector3[] = [];
            for (let s = 0; s <= nSteps; s++) {
                const y = (s / nSteps) * length;
                linePoints.push(new Vector3(
                    (xs[ni] + xs[nj]) / 2 - xMid,
                    y - length / 2,
                    (zs[ni] + zs[nj]) / 2 - zMid
                ));
            }
        }

        // 단면 윤곽선 (시작/끝)
        for (const yPos of [0, length]) {
            const Ym = shapeFunc(yPos);
            const points: Vector3[] = [];
            // 절점 순서대로 연결
            for (let n = 0; n < nnodes; n++) {
                const dx = uDisp[n] * Ym;
                const dz = wDisp[n] * Ym;
                points.push(new Vector3(
                    xs[n] + dx - xMid,
                    yPos - length / 2,
                    zs[n] + dz - zMid
                ));
            }
            if (points.length > 1) {
                const lines = MeshBuilder.CreateLines(
                    `outline_${yPos}`,
                    { points },
                    this._scene!
                );
                lines.color = new Color3(0.3, 0.8, 1.0);
                this._wireframes.push(lines);
            }
        }
    }

    private _clearMeshes(): void {
        this._mesh?.dispose();
        this._mesh = null;
        for (const w of this._wireframes) { w.dispose(); }
        this._wireframes = [];
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
        this._canvas.addEventListener('pointerdown', (e: PointerEvent) => {
            this._isDragging = true;
            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;
        });

        this._canvas.addEventListener('pointermove', (e: PointerEvent) => {
            if (!this._isDragging) { return; }
            const dx = e.clientX - this._lastMouseX;
            const dy = e.clientY - this._lastMouseY;
            this._rotX += dx * 0.01;
            this._rotY = Math.max(-1.5, Math.min(1.5, this._rotY + dy * 0.01));
            this._lastMouseX = e.clientX;
            this._lastMouseY = e.clientY;
        });

        this._canvas.addEventListener('pointerup', () => { this._isDragging = false; });
        this._canvas.addEventListener('pointerleave', () => { this._isDragging = false; });

        this._canvas.addEventListener('wheel', (e: WheelEvent) => {
            this._distance *= e.deltaY > 0 ? 1.1 : 0.9;
            this._distance = Math.max(1, Math.min(10000, this._distance));
            e.preventDefault();
        });
    }

    dispose(): void {
        this._clearMeshes();
        this._scene?.dispose();
        this._engine?.dispose();
        this._engine = null;
        this._scene = null;
    }
}
