/**
 * CUFSM WebView 패널
 *
 * 참조: 컨버전전략.md §5.3 WebView, §11 VS Code 테마 연동
 * stgen dxfEditorProvider.ts 패턴 참조
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { PythonBridge } from '../bridge/PythonBridge';
import { ProjectExplorerProvider } from './ProjectExplorerProvider';
import { McpBridgeServer, McpPanelInterface } from '../mcp/bridge';
import { CufsmModel, CufsmResult, WebviewToExtMessage, createDefaultModel } from '../models/types';

export class CufsmPanel implements McpPanelInterface {
    public static readonly viewType = 'cufsm.designer';
    public static currentPanel: CufsmPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _pythonBridge: PythonBridge;
    private readonly _treeProvider?: ProjectExplorerProvider;
    private _disposed = false;
    private _currentSection = 'preprocessor';

    private _model: CufsmModel;
    private _lastAnalysisResult: any = null;

    public static createOrShow(
        extensionUri: vscode.Uri,
        pythonBridge: PythonBridge,
        treeProvider?: ProjectExplorerProvider
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (CufsmPanel.currentPanel) {
            CufsmPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            CufsmPanel.viewType,
            'CUFSM Section Designer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'webview'),
                ],
            }
        );

        CufsmPanel.currentPanel = new CufsmPanel(panel, extensionUri, pythonBridge, treeProvider);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        pythonBridge: PythonBridge,
        treeProvider?: ProjectExplorerProvider
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._pythonBridge = pythonBridge;
        this._treeProvider = treeProvider;
        this._model = createDefaultModel();

        this._panel.webview.html = this._getHtmlForWebview();

        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtMessage) => this._handleMessage(message)
        );

        this._panel.onDidDispose(() => this._dispose());

        // 초기 트리 갱신
        setTimeout(() => this._updateTreeView(), 500);
    }

    /** 트리 클릭 → 해당 섹션으로 이동 */
    public showSection(sectionId: string): void {
        this._currentSection = sectionId;
        this._postMessage('showSection', { sectionId });
    }

    /** WebView로 메시지 전송 */
    public postMessage(command: string, data: any): void {
        this._postMessage(command, data);
    }

    /** 초기 기본 단면 생성 후 모델 전송 */
    private async _initializeWithDefaultSection(): Promise<void> {
        try {
            // Python 엔진으로 Lipped C-channel 기본 단면 생성
            const result = await this._pythonBridge.call('generate_section', {
                section_type: 'lippedc',
                params: { H: 9, B: 5, D: 1, t: 0.1, r: 0 }
            });
            if (result && result.node && result.elem) {
                this._model.node = result.node;
                this._model.elem = result.elem;
                // 균일 축압축 응력 기본값
                for (const n of this._model.node) {
                    n[7] = 50.0;
                }
            }
        } catch (err: any) {
            console.error('[CUFSM] Failed to generate default section:', err.message);
            // Python 미연결 시에도 빈 모델로 진행
        }

        // 기본 길이 설정
        if (!this._model.lengths || this._model.lengths.length === 0) {
            const lengths: number[] = [];
            for (let i = 0; i < 50; i++) {
                lengths.push(Math.pow(10, 0 + 3 * i / 49));
            }
            this._model.lengths = lengths;
            this._model.m_all = lengths.map(() => [1]);
        }

        this._postMessage('modelLoaded', this._model);
        this._updateTreeView();
    }

    /** 트리뷰 갱신 */
    private _updateTreeView(): void {
        if (this._treeProvider) {
            this._treeProvider.updateProjectData({
                name: 'Current Section',
                nnodes: this._model.node?.length || 0,
                nelems: this._model.elem?.length || 0,
                BC: this._model.BC || 'S-S',
                nlengths: this._model.lengths?.length || 0,
                hasResults: false,
            });
        }
    }

    /** WebView에서 수신한 메시지 처리 */
    private async _handleMessage(message: WebviewToExtMessage): Promise<void> {
        switch (message.command) {
            case 'webviewReady':
                // WebView 초기화 완료 → 기본 템플릿으로 초기 단면 생성
                await this._initializeWithDefaultSection();
                break;

            case 'runAnalysis':
                await this._runAnalysis(message.data);
                break;

            case 'setStress':
                await this.handleMcpAction({ action: 'set_stress', ...message.data });
                break;

            case 'getProperties':
                await this._getProperties(message.data);
                break;

            case 'updateModel':
                this._model = { ...this._model, ...message.data };
                this._updateTreeView();
                break;

            case 'generateTemplate':
                await this._generateTemplate(message.data);
                break;

            case 'applyStress':
                await this._applyStress(message.data);
                break;

            case 'classifyModes':
                await this._classifyModes(message.data);
                break;

            case 'runPlastic':
                await this._runPlastic(message.data);
                break;

        }
    }

    /** 좌굴 해석 실행 */
    private async _runAnalysis(model: CufsmModel): Promise<void> {
        this._postMessage('analysisStarted', null);
        try {
            const result = await this._pythonBridge.analyze(model);
            this._lastAnalysisResult = result;
            this._postMessage('analysisComplete', result);

            // DSM 설계값 자동 추출 — P(축력)와 Mxx(휨) 모두
            try {
                const dsmP = await this._pythonBridge.call('dsm', {
                    node: model.node, elem: model.elem,
                    curve: result.curve, fy: 50.0, load_type: 'P',
                });
                const dsmM = await this._pythonBridge.call('dsm', {
                    node: model.node, elem: model.elem,
                    curve: result.curve, fy: 50.0, load_type: 'Mxx',
                });
                this._postMessage('dsmResult', { P: dsmP, Mxx: dsmM });
            } catch (dsmErr: any) {
                console.error('[CUFSM] DSM extraction failed:', dsmErr.message);
            }

            // cFSM 모드 분류 자동 실행
            try {
                const classResult = await this._pythonBridge.call('classify', {
                    model: model,
                    shapes: result.shapes || [],
                });
                this._postMessage('classifyResult', classResult);
            } catch (clsErr: any) {
                console.error('[CUFSM] Classification failed:', clsErr.message);
            }

            // 트리뷰에 결과 표시
            if (this._treeProvider) {
                this._treeProvider.updateProjectData({
                    name: 'Current Section',
                    nnodes: model.node?.length || 0,
                    nelems: model.elem?.length || 0,
                    BC: model.BC || 'S-S',
                    nlengths: model.lengths?.length || 0,
                    hasResults: true,
                });
            }
        } catch (err: any) {
            this._postMessage('analysisError', { error: err.message });
            vscode.window.showErrorMessage(`CUFSM Analysis Error: ${err.message}`);
        }
    }

    /** 단면 성질 계산 */
    private async _getProperties(data: { node: number[][]; elem: number[][] }): Promise<void> {
        try {
            const props = await this._pythonBridge.getProperties(data.node, data.elem);
            this._postMessage('propertiesResult', props);
        } catch (err: any) {
            this._postMessage('propertiesError', { error: err.message });
        }
    }

    /** MCP: 현재 상태 반환 */
    public getStatus(): any {
        const node = this._model.node || [];
        const elem = this._model.elem || [];
        const prop = this._model.prop || [];
        const lengths = this._model.lengths || [];

        // 단면 범위 계산
        let xMin = 0, xMax = 0, zMin = 0, zMax = 0;
        if (node.length > 0) {
            const xs = node.map((n: number[]) => n[1]);
            const zs = node.map((n: number[]) => n[2]);
            xMin = Math.min(...xs); xMax = Math.max(...xs);
            zMin = Math.min(...zs); zMax = Math.max(...zs);
        }

        // 응력 범위
        let stressMin = 0, stressMax = 0;
        if (node.length > 0) {
            const stresses = node.map((n: number[]) => n[7]);
            stressMin = Math.min(...stresses);
            stressMax = Math.max(...stresses);
        }

        // 재료
        const mat = prop.length > 0 ? prop[0] : [100, 29500, 29500, 0.3, 0.3, 11346];

        return {
            nnodes: node.length,
            nelems: elem.length,
            BC: this._model.BC || 'S-S',
            nlengths: lengths.length,
            hasModel: node.length > 0,
            hasAnalysis: !!this._lastAnalysisResult,
            // 단면 치수
            section: {
                width: +(xMax - xMin).toFixed(4),
                height: +(zMax - zMin).toFixed(4),
                xRange: [+xMin.toFixed(4), +xMax.toFixed(4)],
                zRange: [+zMin.toFixed(4), +zMax.toFixed(4)],
            },
            // 재료
            material: { E: mat[1], v: mat[3], G: mat[5] },
            // 응력
            stress: { min: +stressMin.toFixed(4), max: +stressMax.toFixed(4) },
            // 길이 범위
            lengths: lengths.length > 0
                ? { min: +lengths[0].toFixed(2), max: +lengths[lengths.length - 1].toFixed(2), n: lengths.length }
                : null,
            // GBTcon
            GBTcon: (this._model as any).GBTcon || null,
            // 스프링/구속
            nsprings: ((this._model as any).springs || []).length,
            nconstraints: ((this._model as any).constraints || []).length,
        };
    }

    /** MCP: 액션 처리 — Bridge에서 직접 호출 */
    public async handleMcpAction(options: any): Promise<any> {
        const action = options?.action;

        switch (action) {
            case 'generate_template': {
                const result = await this._pythonBridge.call('generate_section', {
                    section_type: options.section_type,
                    params: options.params,
                });
                if (result?.node) {
                    this._model.node = result.node;
                    this._model.elem = result.elem;
                    for (const n of this._model.node) { n[7] = 50.0; }
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                }
                return { success: true, nnodes: result?.node?.length, nelems: result?.elem?.length };
            }

            case 'set_material': {
                const E = options.E || 29500;
                const v = options.v || 0.3;
                const G = options.G || E / (2 * (1 + v));
                this._model.prop = [[100, E, E, v, v, G]];
                this._postMessage('modelLoaded', this._model);
                return { success: true, E, v, G };
            }

            case 'set_bc': {
                this._model.BC = options.BC || 'S-S';
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, BC: this._model.BC };
            }

            case 'set_lengths': {
                const min = options.min || 1;
                const max = options.max || 1000;
                const n = options.n || 50;
                const lengths: number[] = [];
                for (let i = 0; i < n; i++) {
                    lengths.push(Math.pow(10, Math.log10(min) + (Math.log10(max) - Math.log10(min)) * i / (n - 1)));
                }
                this._model.lengths = lengths;
                this._model.m_all = lengths.map(() => [1]);
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, n: lengths.length };
            }

            case 'set_load_case': {
                const lc = options.load_case || 'compression';
                const fy = options.fy || 50;
                let stressOpts: any;
                if (lc === 'compression') {
                    stressOpts = { action: 'set_stress', type: 'uniform_compression', fy };
                } else if (lc === 'bending_xx' || lc === 'bending_xx_pos') {
                    stressOpts = { action: 'set_stress', type: 'pure_bending', fy };
                } else if (lc === 'bending_xx_neg') {
                    // -Mxx: z- 쪽 압축 → Mxx=-1로 반전
                    stressOpts = { action: 'set_stress', type: 'custom', P: 0, Mxx: -1, Mzz: 0, fy };
                } else if (lc === 'bending_zz' || lc === 'bending_zz_pos') {
                    stressOpts = { action: 'set_stress', type: 'custom', P: 0, Mxx: 0, Mzz: 1, fy };
                } else if (lc === 'bending_zz_neg') {
                    // -Mzz: x- 쪽 압축 → Mzz=-1
                    stressOpts = { action: 'set_stress', type: 'custom', P: 0, Mxx: 0, Mzz: -1, fy };
                } else {
                    stressOpts = { action: 'set_stress', type: 'custom', P: options.P || 0, Mxx: options.Mxx || 0, Mzz: options.Mzz || 0 };
                }
                const lcResult = await this.handleMcpAction(stressOpts);
                (this._model as any).loadCase = lc;
                (this._model as any).loadFy = fy;
                return { success: true, load_case: lc, fy, stress_result: lcResult };
            }

            case 'set_stress': {
                const fy = options.fy || 50;
                if (options.type === 'uniform_compression') {
                    for (const n of this._model.node) { n[7] = fy; }
                } else if (options.type === 'pure_bending') {
                    const result = await this._pythonBridge.call('stresgen', {
                        node: this._model.node,
                        props: await this._pythonBridge.call('get_properties', {
                            node: this._model.node, elem: this._model.elem
                        }),
                        loads: { P: 0, Mxx: 1, Mzz: 0, M11: 0, M22: 0 },
                    });
                    if (result?.node) {
                        // Mxx=1 단위모멘트 → fy로 스케일링하여 극한섬유 응력 = fy
                        let maxStress = 0;
                        for (const n of result.node) {
                            maxStress = Math.max(maxStress, Math.abs(n[7]));
                        }
                        if (maxStress > 0) {
                            const scale = fy / maxStress;
                            for (const n of result.node) { n[7] *= scale; }
                        }
                        this._model.node = result.node;
                    }
                } else if (options.type === 'custom') {
                    const result = await this._pythonBridge.call('stresgen', {
                        node: this._model.node,
                        props: await this._pythonBridge.call('get_properties', {
                            node: this._model.node, elem: this._model.elem
                        }),
                        loads: { P: options.P || 0, Mxx: options.Mxx || 0, Mzz: options.Mzz || 0, M11: 0, M22: 0 },
                    });
                    if (result?.node) {
                        // fy가 지정되면 극한섬유 응력을 fy로 스케일링
                        if (options.fy) {
                            let maxStress = 0;
                            for (const n of result.node) {
                                maxStress = Math.max(maxStress, Math.abs(n[7]));
                            }
                            if (maxStress > 0) {
                                const scale = options.fy / maxStress;
                                for (const n of result.node) { n[7] *= scale; }
                            }
                        }
                        this._model.node = result.node;
                    }
                }
                this._postMessage('modelLoaded', this._model);
                return { success: true };
            }

            case 'run_analysis': {
                const result = await this._pythonBridge.analyze(this._model as any);
                this._lastAnalysisResult = result;
                this._postMessage('analysisComplete', result);

                // DSM 자동 추출
                try {
                    const dsmP = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: result.curve, fy: 50, load_type: 'P',
                    });
                    const dsmM = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: result.curve, fy: 50, load_type: 'Mxx',
                    });
                    this._postMessage('dsmResult', { P: dsmP, Mxx: dsmM });
                    return { success: true, n_lengths: result.n_lengths, dsm_P: dsmP, dsm_Mxx: dsmM };
                } catch {
                    return { success: true, n_lengths: result.n_lengths };
                }
            }

            case 'get_dsm': {
                const dsmP = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: (this as any)._lastCurve || [], fy: options.fy || 50, load_type: 'P',
                });
                const dsmM = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: (this as any)._lastCurve || [], fy: options.fy || 50, load_type: 'Mxx',
                });
                return { P: dsmP, Mxx: dsmM };
            }

            case 'get_properties': {
                return await this._pythonBridge.getProperties(this._model.node, this._model.elem);
            }

            case 'get_nodes': {
                return { nodes: this._model.node };
            }

            case 'get_elements': {
                return { elements: this._model.elem };
            }

            case 'doubler': {
                const result = await this._pythonBridge.call('doubler', {
                    node: this._model.node, elem: this._model.elem,
                });
                if (result?.node) {
                    this._model.node = result.node;
                    this._model.elem = result.elem;
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                }
                return { success: true, nnodes: result?.node?.length };
            }

            case 'cutwp': {
                return await this._pythonBridge.call('cutwp', {
                    node: this._model.node, elem: this._model.elem,
                });
            }

            case 'classify': {
                if (!this._lastAnalysisResult) {
                    return { error: 'No analysis result. Run analysis first.' };
                }
                const classResult = await this._pythonBridge.call('classify', {
                    model: this._model,
                    shapes: this._lastAnalysisResult.shapes || [],
                    GBTcon: options.GBTcon || (this._model as any).GBTcon,
                });
                this._postMessage('classifyResult', classResult);
                return classResult;
            }

            // --- #19: run_vibration ---
            case 'vibration': {
                const result = await this._pythonBridge.call('vibration', {
                    node: this._model.node, elem: this._model.elem,
                    prop: this._model.prop, lengths: this._model.lengths,
                    BC: this._model.BC || 'S-S', m_all: this._model.m_all,
                    rho: options.rho || 1.0,
                });
                this._postMessage('vibrationResult', result);
                return result;
            }

            // --- #20: run_plastic_surface ---
            case 'plastic': {
                const result = await this._pythonBridge.call('plastic', {
                    node: this._model.node, elem: this._model.elem,
                    fy: options.fy || 50,
                });
                this._postMessage('plasticResult', result);
                return result;
            }

            // --- #21: save_project ---
            case 'save_project': {
                const fs = require('fs');
                const data = JSON.stringify(this._model, null, 2);
                fs.writeFileSync(options.filepath, data, 'utf8');
                return { success: true, filepath: options.filepath };
            }

            // --- #22: run_signature_curve ---
            case 'signature_ss': {
                // S-S 경계조건, 자동 길이 범위 (100점)
                this._model.BC = 'S-S';
                const n = 100;
                const minL = 1; const maxL = 1000;
                const lengths: number[] = [];
                for (let i = 0; i < n; i++) {
                    lengths.push(Math.pow(10, Math.log10(minL) + (Math.log10(maxL) - Math.log10(minL)) * i / (n - 1)));
                }
                this._model.lengths = lengths;
                this._model.m_all = lengths.map(() => [1]);
                this._postMessage('modelLoaded', this._model);

                const result = await this._pythonBridge.analyze(this._model as any);
                this._lastAnalysisResult = result;
                this._postMessage('analysisComplete', result);
                return { success: true, n_lengths: result.n_lengths };
            }

            // --- #23: set_node_stress ---
            case 'set_node_stress': {
                const nodeIds: number[] = options.node_ids || [];
                const stress: number = options.stress || 0;
                for (const id of nodeIds) {
                    if (id >= 1 && id <= this._model.node.length) {
                        this._model.node[id - 1][7] = stress;
                    }
                }
                this._postMessage('modelLoaded', this._model);
                return { success: true, updated: nodeIds.length };
            }

            // --- #24: get_buckling_curve ---
            case 'get_curve': {
                if (!this._lastAnalysisResult || !this._lastAnalysisResult.curve) {
                    return { error: 'No analysis result. Run analysis first.' };
                }
                return { curve: this._lastAnalysisResult.curve };
            }

            // --- #25: set_springs ---
            case 'set_springs': {
                const springs: number[][] = options.springs || [];
                (this._model as any).springs = springs;
                this._postMessage('modelLoaded', this._model);
                return { success: true, nsprings: springs.length };
            }

            // --- #26: set_constraints ---
            case 'set_constraints': {
                const constraints: number[][] = options.constraints || [];
                (this._model as any).constraints = constraints;
                this._postMessage('modelLoaded', this._model);
                return { success: true, nconstraints: constraints.length };
            }

            // --- set_nodes: 전체 절점 배열 교체 ---
            case 'set_nodes': {
                const nodes: number[][] = options.nodes || [];
                this._model.node = nodes;
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nnodes: nodes.length };
            }

            // --- set_elements: 전체 요소 배열 교체 ---
            case 'set_elements': {
                const elements: number[][] = options.elements || [];
                this._model.elem = elements;
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nelems: elements.length };
            }

            // --- add_node: 절점 1개 추가 ---
            case 'add_node': {
                const nodeArr = this._model.node || [];
                const newId = nodeArr.length + 1;
                nodeArr.push([newId, options.x || 0, options.z || 0, 1, 1, 1, 1, options.stress || 0]);
                this._model.node = nodeArr;
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, node_id: newId, nnodes: nodeArr.length };
            }

            // --- add_element: 요소 1개 추가 ---
            case 'add_element': {
                const elemArr = this._model.elem || [];
                const newElemId = elemArr.length + 1;
                const matnum = (this._model.prop && this._model.prop[0]) ? this._model.prop[0][0] : 100;
                elemArr.push([newElemId, options.nodei, options.nodej, options.thickness, matnum]);
                this._model.elem = elemArr;
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, elem_id: newElemId, nelems: elemArr.length };
            }

            // --- modify_node: 절점 좌표/응력 수정 ---
            case 'modify_node': {
                const nid = options.node_id;
                if (!this._model.node || nid < 1 || nid > this._model.node.length) {
                    return { error: `Invalid node_id: ${nid}` };
                }
                const nd = this._model.node[nid - 1];
                if (options.x !== undefined) { nd[1] = options.x; }
                if (options.z !== undefined) { nd[2] = options.z; }
                if (options.stress !== undefined) { nd[7] = options.stress; }
                this._postMessage('modelLoaded', this._model);
                return { success: true, node: nd };
            }

            // --- delete_node: 절점 삭제 + 연결 요소 제거 ---
            case 'delete_node': {
                const dnid = options.node_id;
                if (!this._model.node || dnid < 1 || dnid > this._model.node.length) {
                    return { error: `Invalid node_id: ${dnid}` };
                }
                // 연결 요소 제거
                this._model.elem = (this._model.elem || []).filter(
                    (e: number[]) => e[1] !== dnid && e[2] !== dnid
                );
                // 절점 제거
                this._model.node.splice(dnid - 1, 1);
                // 절점 번호 재부여
                this._model.node.forEach((n: number[], i: number) => { n[0] = i + 1; });
                // 요소의 절점 참조 업데이트
                this._model.elem.forEach((e: number[]) => {
                    if (e[1] > dnid) { e[1]--; }
                    if (e[2] > dnid) { e[2]--; }
                });
                // 요소 번호 재부여
                this._model.elem.forEach((e: number[], i: number) => { e[0] = i + 1; });
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nnodes: this._model.node.length, nelems: this._model.elem.length };
            }

            // --- modify_element: 요소 두께/연결 수정 ---
            case 'modify_element': {
                const eid = options.elem_id;
                if (!this._model.elem || eid < 1 || eid > this._model.elem.length) {
                    return { error: `Invalid elem_id: ${eid}` };
                }
                const el = this._model.elem[eid - 1];
                if (options.thickness !== undefined) { el[3] = options.thickness; }
                if (options.nodei !== undefined) { el[1] = options.nodei; }
                if (options.nodej !== undefined) { el[2] = options.nodej; }
                this._postMessage('modelLoaded', this._model);
                return { success: true, element: el };
            }

            // --- delete_element: 요소 삭제 ---
            case 'delete_element': {
                const deid = options.elem_id;
                if (!this._model.elem || deid < 1 || deid > this._model.elem.length) {
                    return { error: `Invalid elem_id: ${deid}` };
                }
                this._model.elem.splice(deid - 1, 1);
                this._model.elem.forEach((e: number[], i: number) => { e[0] = i + 1; });
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nelems: this._model.elem.length };
            }

            // --- #28: energy_recovery ---
            case 'energy_recovery': {
                if (!this._lastAnalysisResult) {
                    return { error: 'No analysis result. Run analysis first.' };
                }
                const li = options.length_index ?? 0;
                const mi = options.mode_index ?? 0;
                const shapes = this._lastAnalysisResult.shapes;
                if (!shapes || !shapes[li]) {
                    return { error: `No shape data at length index ${li}` };
                }
                const shapeMatrix = shapes[li];
                let modeVec: number[];
                if (Array.isArray(shapeMatrix[0])) {
                    modeVec = shapeMatrix.map((row: number[]) => row[mi] || 0);
                } else {
                    modeVec = shapeMatrix;
                }
                const curveRow = this._lastAnalysisResult.curve[li];
                const length = curveRow ? curveRow[0] : 100;

                const result = await this._pythonBridge.call('energy_recovery', {
                    node: this._model.node,
                    elem: this._model.elem,
                    prop: this._model.prop,
                    mode: modeVec,
                    length: length,
                    BC: this._model.BC || 'S-S',
                });
                return result;
            }

            // --- get_full_state: 전체 모델+해석 상태 ---
            case 'get_full_state': {
                const status = this.getStatus();
                const result: any = { ...status };

                // 해석 결과 요약
                if (this._lastAnalysisResult && this._lastAnalysisResult.curve) {
                    const curve = this._lastAnalysisResult.curve;
                    const summary = [];
                    for (let i = 0; i < curve.length; i++) {
                        if (curve[i] && curve[i].length >= 2 && curve[i][1] > 0) {
                            summary.push({ length: +curve[i][0].toFixed(3), LF: +curve[i][1].toFixed(5) });
                        }
                    }
                    // 극소값 찾기
                    const minima = [];
                    for (let i = 1; i < summary.length - 1; i++) {
                        if (summary[i].LF < summary[i-1].LF && summary[i].LF < summary[i+1].LF) {
                            minima.push(summary[i]);
                        }
                    }
                    result.curve_summary = {
                        n_points: summary.length,
                        LF_min: summary.length > 0 ? Math.min(...summary.map(s => s.LF)) : null,
                        minima: minima,
                    };
                }

                return result;
            }

            // --- #27: set_gbtcon ---
            case 'set_gbtcon': {
                (this._model as any).GBTcon = {
                    ospace: options.ospace ?? 1,
                    norm: options.norm ?? 0,
                    couple: options.couple ?? 1,
                    orth: options.orth ?? 1,
                    glob: options.glob || [],
                    dist: options.dist || [],
                    local: options.local || [],
                    other: options.other || [],
                };
                return { success: true, GBTcon: (this._model as any).GBTcon };
            }

            default:
                return { error: `Unknown action: ${action}` };
        }
    }

    /** 소성곡면 생성 */
    private async _runPlastic(data: { node: number[][]; elem: number[][]; fy: number }): Promise<void> {
        try {
            const result = await this._pythonBridge.call('plastic', data);
            this._postMessage('plasticResult', result);
        } catch (err: any) {
            this._postMessage('plasticError', { error: err.message });
        }
    }

    /** cFSM 모드 분류 */
    private async _classifyModes(data: any): Promise<void> {
        try {
            const result = await this._pythonBridge.call('classify', data);
            this._postMessage('classifyResult', result);
        } catch (err: any) {
            this._postMessage('classifyError', { error: err.message });
        }
    }

    /** 단면 템플릿 생성 */
    private async _generateTemplate(data: { section_type: string; params: any }): Promise<void> {
        try {
            const result = await this._pythonBridge.call('generate_section', data);
            if (result?.node) {
                this._model.node = result.node;
                this._model.elem = result.elem;
            }
            this._postMessage('templateGenerated', result);
        } catch (err: any) {
            this._postMessage('templateError', { error: err.message });
        }
    }

    /** 응력 분포 적용 */
    private async _applyStress(data: any): Promise<void> {
        try {
            const result = await this._pythonBridge.call('stresgen', data);
            this._postMessage('stressApplied', result);
        } catch (err: any) {
            this._postMessage('stressError', { error: err.message });
        }
    }

    /** WebView로 메시지 전송 */
    private _postMessage(command: string, data: any): void {
        if (!this._disposed) {
            this._panel.webview.postMessage({ command, data });
        }
    }

    /** WebView HTML 생성 */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;
        const nonce = getNonce();

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'css', 'theme.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'app.js')
        );

        return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}' 'unsafe-eval';
        img-src ${webview.cspSource} data: blob:;
        font-src ${webview.cspSource};
    ">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>CUFSM Section Designer</title>
</head>
<body>
    <!-- 탭 바 -->
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="preprocessor">Preprocessor</button>
        <button class="tab-btn" data-tab="analysis">Analysis</button>
        <button class="tab-btn" data-tab="postprocessor">Postprocessor</button>
    </div>

    <!-- 탭 내용 -->
    <div class="tab-content">
        <!-- 전처리 탭 -->
        <div id="tab-preprocessor" class="tab-panel active">
            <div class="panel-row">
                <div class="panel-left">
                    <h3>Section Input</h3>
                    <p class="hint">템플릿 또는 절점/요소 직접 입력으로 단면 형상을 정의합니다.</p>
                    <div class="section-group">
                        <label>Section Template</label>
                        <p class="hint">표준 단면 유형을 선택하고 외측(out-to-out) 치수를 입력하세요. r(코너 반경)은 플랜지-웹 접합부에 원호 요소를 생성합니다.</p>
                        <div class="input-row">
                            <select id="select-template">
                                <option value="">-- 직접 입력 --</option>
                                <option value="lippedc" selected>Lipped C (립부 채널)</option>
                                <option value="lippedz">Lipped Z (립부 Z형강)</option>
                                <option value="track">Track (무립 채널)</option>
                                <option value="hat">Hat (모자형)</option>
                                <option value="rhs">RHS (직사각 중공)</option>
                                <option value="chs">CHS (원형 중공)</option>
                                <option value="angle">Angle (ㄱ형강)</option>
                                <option value="isect">I-Section (I형강)</option>
                                <option value="tee">T-Section (T형강)</option>
                            </select>
                            <button id="btn-generate-template" class="btn-small">생성</button>
                        </div>
                        <div id="template-params" class="input-row" style="margin-top:4px; flex-wrap:wrap;">
                            <label>H<span class="hint-inline">높이</span></label><input type="number" id="tpl-H" value="9" step="0.5" style="width:60px">
                            <label>B<span class="hint-inline">폭</span></label><input type="number" id="tpl-B" value="5" step="0.5" style="width:60px">
                            <label>D<span class="hint-inline">립</span></label><input type="number" id="tpl-D" value="1" step="0.1" style="width:60px">
                            <label>t<span class="hint-inline">두께</span></label><input type="number" id="tpl-t" value="0.1" step="0.01" style="width:60px">
                            <label>r<span class="hint-inline">반경</span></label><input type="number" id="tpl-r" value="0" step="0.1" style="width:60px">
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Material</label>
                        <p class="hint">E = 탄성계수(ksi), v = 포아송비, G = 전단탄성계수(자동 계산 가능)</p>
                        <div class="input-row">
                            <label>E</label><input type="number" id="input-E" value="29500" step="100">
                            <label>v</label><input type="number" id="input-v" value="0.3" step="0.01">
                            <label>G</label><input type="number" id="input-G" value="11346" step="100">
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Load Case</label>
                        <p class="hint">좌굴 해석의 기준 하중 상태를 선택합니다. 휨 방향(+/-)은 단면 좌표축 기준으로 어느 쪽이 압축인지를 결정합니다. Cross Section Preview의 좌표축을 참고하세요.</p>
                        <div class="input-row" style="flex-wrap:wrap;">
                            <select id="select-load-case" style="width:180px">
                                <option value="compression" selected>압축 (Compression)</option>
                                <option value="bending_xx_pos">강축 휨 +Mxx (z+ 압축)</option>
                                <option value="bending_xx_neg">강축 휨 -Mxx (z- 압축)</option>
                                <option value="bending_zz_pos">약축 휨 +Mzz (x+ 압축)</option>
                                <option value="bending_zz_neg">약축 휨 -Mzz (x- 압축)</option>
                                <option value="custom">조합 (P + Mxx + Mzz)</option>
                            </select>
                            <label>Fy<span class="hint-inline">항복</span></label>
                            <input type="number" id="input-fy-load" value="50" step="5" style="width:60px">
                        </div>
                        <div id="custom-load-inputs" class="input-row" style="display:none; margin-top:4px;">
                            <label>P<span class="hint-inline">kips</span></label>
                            <input type="number" id="input-load-P" value="0" step="1" style="width:70px">
                            <label>Mxx<span class="hint-inline">kip-in</span></label>
                            <input type="number" id="input-load-Mxx" value="0" step="10" style="width:70px">
                            <label>Mzz<span class="hint-inline">kip-in</span></label>
                            <input type="number" id="input-load-Mzz" value="0" step="10" style="width:70px">
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Nodes <button id="btn-add-node" class="btn-small">+ 추가</button></label>
                        <p class="hint">절점 좌표(x, z)와 응력(stress). Load Case 선택 시 해석 실행 전에 자동 설정됩니다.</p>
                        <div id="node-table-container" class="table-container">
                            <table id="node-table">
                                <thead><tr><th>#</th><th>x</th><th>z</th><th>stress</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Elements <button id="btn-add-elem" class="btn-small">+ 추가</button></label>
                        <p class="hint">요소 연결(ni→nj)과 두께(t). 각 요소는 하나의 판(strip)을 나타냅니다.</p>
                        <div id="elem-table-container" class="table-container">
                            <table id="elem-table">
                                <thead><tr><th>#</th><th>ni</th><th>nj</th><th>t</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="panel-right">
                    <h3>Cross Section Preview</h3>
                    <p class="hint">중심선(centerline) 모델. 주황색 점 = 절점, 파란색 선 = 요소.</p>
                    <div id="section-preview">
                        <svg id="section-svg" viewBox="-1 -1 12 12" preserveAspectRatio="xMidYMid meet"></svg>
                    </div>
                    <div id="section-props" class="props-display"></div>
                </div>
            </div>
        </div>

        <!-- 해석 탭 -->
        <div id="tab-analysis" class="tab-panel">
            <p class="hint">유한스트립법(FSM) 좌굴 해석 설정. 경계조건과 반파장 범위를 지정하고 해석을 실행합니다.</p>
            <div class="section-group">
                <label>Boundary Condition</label>
                <p class="hint">부재 양단의 경계조건. S=단순지지, C=고정, F=자유, G=가이드.</p>
                <select id="select-bc">
                    <option value="S-S" selected>S-S (단순-단순)</option>
                    <option value="C-C">C-C (고정-고정)</option>
                    <option value="S-C">S-C (단순-고정)</option>
                    <option value="C-F">C-F (고정-자유)</option>
                    <option value="C-G">C-G (고정-가이드)</option>
                </select>
            </div>
            <div class="section-group">
                <label>Lengths (반파장)</label>
                <p class="hint">좌굴 곡선을 계산할 반파장 범위. 국부좌굴은 짧은 파장, 전체좌굴은 긴 파장에서 나타남.</p>
                <div class="input-row">
                    <label>최소</label><input type="number" id="input-len-min" value="1" step="1">
                    <label>최대</label><input type="number" id="input-len-max" value="1000" step="100">
                    <label>개수</label><input type="number" id="input-len-n" value="50" step="10">
                </div>
            </div>
            <div class="section-group">
                <label>고유치 수</label>
                <p class="hint">각 반파장에서 계산할 좌굴 모드 수. 1차 모드가 가장 중요합니다.</p>
                <input type="number" id="input-neigs" value="20" step="1">
            </div>
            <div class="section-group">
                <label>cFSM 모드 분류</label>
                <p class="hint">구속 유한스트립법(cFSM)으로 각 좌굴 모드의 G(전체)/D(뒤틀림)/L(국부)/O(기타) 구성 비율을 계산합니다.</p>
                <div class="input-row">
                    <label><input type="checkbox" id="chk-cfsm-enable"> 활성화</label>
                    <label><input type="checkbox" id="chk-cfsm-G" checked> Global</label>
                    <label><input type="checkbox" id="chk-cfsm-D" checked> Distortional</label>
                    <label><input type="checkbox" id="chk-cfsm-L" checked> Local</label>
                    <label><input type="checkbox" id="chk-cfsm-O" checked> Other</label>
                </div>
                <p class="hint" style="margin-top:4px">활성화 체크 시: 해석 완료 후 Mode Classification 그래프에 G/D/L/O 비율이 표시됩니다. 체크 해제 시: 분류 없이 좌굴 곡선과 모드형상만 계산됩니다. 분류에 추가 계산 시간이 소요됩니다.</p>
            </div>
            <div class="button-row">
                <button id="btn-run-analysis" class="btn-primary">해석 실행</button>
            </div>
            <div id="analysis-status" class="status-bar"></div>
        </div>

        <!-- 후처리 탭 -->
        <div id="tab-postprocessor" class="tab-panel">
            <!-- DSM 설계값 테이블 -->
            <div id="dsm-results" class="section-group" style="margin-bottom:12px">
                <h3>DSM Design Values</h3>
                <p class="hint">직접강도법(DSM) 설계값. Pcrl/Mcrl = 국부좌굴, Pcrd/Mcrd = 뒤틀림좌굴, Pcre/Mcre = 전체좌굴 임계하중.</p>
                <div id="dsm-table-container" class="props-display" style="font-size:13px;">
                    <em>해석을 실행하면 결과가 표시됩니다</em>
                </div>
            </div>
            <div class="panel-row">
                <div class="panel-left">
                    <h3>Buckling Curve</h3>
                    <p class="hint">반파장(x축) 대비 하중계수(y축) 곡선. 극소점이 좌굴 임계값을 나타냅니다. 마우스를 올리면 십자 커서와 좌표가 표시됩니다.</p>
                    <canvas id="buckling-curve-canvas" width="700" height="400"></canvas>
                    <h3>Mode Classification (G/D/L/O)</h3>
                    <p class="hint">cFSM 기반 모드 분류. 각 반파장에서 1차 좌굴 모드의 G/D/L/O 구성비를 누적 영역으로 표시합니다.</p>
                    <canvas id="classify-curve-canvas" width="700" height="200"></canvas>
                    <h3>Plastic Interaction Surface</h3>
                    <p class="hint">주축(principal axis) 좌표계 기준 P-M 소성 상호작용 다이어그램. 항복값으로 정규화된 축력-모멘트 조합을 표시합니다.</p>
                    <div class="input-row" style="margin-bottom:6px">
                        <label>fy<span class="hint-inline">항복응력</span></label><input type="number" id="input-fy" value="50" step="5" style="width:60px">
                        <button id="btn-run-plastic" class="btn-small">곡면 생성</button>
                    </div>
                    <canvas id="plastic-surface-canvas" width="700" height="420"></canvas>
                </div>
                <div class="panel-right">
                    <h3>Mode Shape</h3>
                    <p class="hint">선택한 반파장/모드에서의 단면 변형 형상. 주황색 = 변형, 회색 = 미변형. Length 드롭다운에서 반파장을 선택하세요.</p>
                    <div id="mode-shape-container">
                        <div class="input-row">
                            <label>Length</label>
                            <select id="select-length"></select>
                            <label>Mode</label>
                            <select id="select-mode"></select>
                        </div>
                        <canvas id="mode-shape-canvas" width="600" height="340"></canvas>
                    </div>
                    <h3>3D Mode Shape</h3>
                    <p class="hint">좌굴 변형의 3D 시각화. Length 값이 바뀌면 해당 반파장에서의 좌굴 모드가 달라집니다 — 짧은 Length(~1~10in)는 국부좌굴(웹/플랜지 파형), 중간 Length(~15~40in)는 뒤틀림좌굴(립-플랜지 회전), 긴 Length(~100in+)는 전체좌굴(횡비틀림)을 보여줍니다. 마우스 드래그=회전, 스크롤=확대/축소.</p>
                    <canvas id="mode-shape-3d-canvas" width="600" height="400"></canvas>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
    <script nonce="${nonce}" src="${webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'charts', 'modeShape3D.js')
        )}" defer></script>
    <script nonce="${nonce}" src="${webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer3d.js')
        )}" defer></script>
</body>
</html>`;
    }

    private _dispose(): void {
        CufsmPanel.currentPanel = undefined;
        this._disposed = true;
        this._panel.dispose();
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
