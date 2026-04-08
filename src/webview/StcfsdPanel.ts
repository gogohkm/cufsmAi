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
import { StcfsdModel, StcfsdResult, WebviewToExtMessage, createDefaultModel } from '../models/types';

export class StcfsdPanel implements McpPanelInterface {
    public static readonly viewType = 'stcfsd.designer';
    public static currentPanel: StcfsdPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _pythonBridge: PythonBridge;
    private readonly _treeProvider?: ProjectExplorerProvider;
    private _disposed = false;
    private _currentSection = 'preprocessor';

    private _model: StcfsdModel;
    private _lastAnalysisResult: any = null;
    private _lastPreviewPath: string = '';
    private _previewResolve: ((value: any) => void) | null = null;

    public static createOrShow(
        extensionUri: vscode.Uri,
        pythonBridge: PythonBridge,
        treeProvider?: ProjectExplorerProvider
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (StcfsdPanel.currentPanel) {
            StcfsdPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            StcfsdPanel.viewType,
            'StCFSD Section Designer',
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

        StcfsdPanel.currentPanel = new StcfsdPanel(panel, extensionUri, pythonBridge, treeProvider);
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

    /** 초기 기본 단면 생성 후 모델 전송 — UI 기본값과 일치시킴 */
    private async _initializeWithDefaultSection(): Promise<void> {
        try {
            // UI 기본값: H=100mm(3.937in), B=50mm(1.969in), D=20mm(0.787in),
            //           t=2.3mm(0.0906in), r=4mm(0.157in) — SGC400
            const result = await this._pythonBridge.call('generate_section', {
                section_type: 'lippedc',
                params: { H: 3.937, B: 1.969, D: 0.787, t: 0.0906, r: 0.157 }
            });
            if (result && result.node && result.elem) {
                this._model.node = result.node;
                this._model.elem = result.elem;
                (this._model as any).sectionType = 'C';
            }
            // 기본 강종 SGC400: Fy=35.53 ksi → 휨 응력 설정
            const fy = 35.53;
            (this._model as any).loadFy = fy;
            await this.handleMcpAction({
                action: 'set_stress', type: 'pure_bending', fy
            });
        } catch (err: any) {
            console.error('[StCFSD] Failed to generate default section:', err.message);
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
    private _updateTreeView(extra?: Record<string, any>): void {
        if (this._treeProvider) {
            this._treeProvider.updateProjectData({
                name: 'Current Section',
                nnodes: this._model.node?.length || 0,
                nelems: this._model.elem?.length || 0,
                BC: this._model.BC || 'S-S',
                nlengths: this._model.lengths?.length || 0,
                hasResults: !!this._lastAnalysisResult,
                ...(extra || {}),
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
                // 프론트엔드 model을 익스텐션 모델에 병합 (prop, lengths, BC 등)
                // 단, node/elem은 setStress에서 이미 설정된 this._model 것을 사용
                if (message.data) {
                    if (message.data.prop) this._model.prop = message.data.prop;
                    if (message.data.lengths) this._model.lengths = message.data.lengths;
                    if (message.data.m_all) this._model.m_all = message.data.m_all;
                    if (message.data.BC) this._model.BC = message.data.BC;
                    if (message.data.neigs) this._model.neigs = message.data.neigs;
                }
                await this._runAnalysis(this._model);
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

            case 'saveProject':
                // WebView에서 Design 탭 데이터를 수집하도록 요청
                this._postMessage('collectDesignData', null);
                // 응답은 'designDataCollected' 메시지로 옴
                break;

            case 'designDataCollected':
                await this._saveProject(message.data);
                break;

            case 'openProject':
                await this._openProject();
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

            case 'runLapConnection':
                try {
                    const lapResult = await this._pythonBridge.call('lap_connection', message.data);
                    this._postMessage('lapConnectionResult', lapResult);
                } catch (e: any) {
                    this._postMessage('lapConnectionResult', { error: e.message });
                }
                break;

            case 'runConnection':
                try {
                    const connResult = await this._pythonBridge.call('design_connection', message.data);
                    this._postMessage('connectionResult', connResult);
                } catch (e: any) {
                    this._postMessage('connectionResult', { error: e.message });
                }
                break;

            case 'runDesign':
                try {
                    await this.handleMcpAction({ action: 'aisi_design', ...message.data });
                } catch (e: any) {
                    this._postMessage('designResult', { error: e.message || String(e) });
                }
                break;

            case 'analyzeLoads':
                try {
                    const loadResult = await this.handleMcpAction({ action: 'analyze_loads', ...message.data });
                    this._postMessage('loadAnalysisComplete', loadResult);
                } catch (e: any) {
                    this._postMessage('loadAnalysisComplete', { error: e.message || String(e) });
                }
                break;

            case 'treeUpdate':
                // WebView에서 상세 트리 데이터 전송 → 트리뷰 갱신
                this._updateTreeView(message.data || {});
                break;

            case 'sectionPreviewResult':
                // WebView에서 PNG 캡처 완료 → 파일로 저장
                if (message.data?.png_base64) {
                    try {
                        const base64 = message.data.png_base64.replace(/^data:image\/png;base64,/, '');
                        const buf = Buffer.from(base64, 'base64');
                        const fs = require('fs');
                        const os = require('os');
                        const path = require('path');
                        const filePath = path.join(os.tmpdir(), 'cufsm_section_preview.png');
                        fs.writeFileSync(filePath, buf);
                        this._lastPreviewPath = filePath;
                    } catch {}
                }
                // resolve pending promise
                if (this._previewResolve) {
                    this._previewResolve(message.data);
                    this._previewResolve = null;
                }
                break;

        }
    }

    /** 좌굴 해석 실행 */
    private async _runAnalysis(model: StcfsdModel): Promise<void> {
        this._postMessage('analysisStarted', null);
        try {
            const result = await this._pythonBridge.analyze(model);
            this._lastAnalysisResult = result;
            this._postMessage('analysisComplete', result);

            // DSM 설계값 자동 추출 — P(축력)와 Mxx(휨) 모두
            const aFy = this._getAnalysisFy();
            try {
                const dsmP = await this._pythonBridge.call('dsm', {
                    node: model.node, elem: model.elem,
                    curve: result.curve, fy: aFy, load_type: 'P',
                });
                const dsmM = await this._pythonBridge.call('dsm', {
                    node: model.node, elem: model.elem,
                    curve: result.curve, fy: aFy, load_type: 'Mxx',
                });
                this._postMessage('dsmResult', { P: dsmP, Mxx: dsmM });
            } catch (dsmErr: any) {
                console.error('[StCFSD] DSM extraction failed:', dsmErr.message);
            }

            // cFSM 모드 분류 자동 실행
            try {
                const classResult = await this._pythonBridge.call('classify', {
                    model: model,
                    shapes: result.shapes || [],
                });
                this._postMessage('classifyResult', classResult);
            } catch (clsErr: any) {
                console.error('[StCFSD] Classification failed:', clsErr.message);
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

    /** 해석 시 사용된 Fy 반환 (loadFy → 노드 최대응력 → MCP 기본값 fallback) */
    private _getAnalysisFy(): number {
        return (this._model as any).loadFy
            || Math.max(...this._model.node.map((n: number[]) => Math.abs(n[7] || 0)), 0)
            || 35.53;
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
                    const fy = (this._model as any).loadFy || 35.53;
                    for (const n of this._model.node) { n[7] = fy; }
                    (this._model as any).loadFy = fy;
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
                const fy = options.fy || 35.53;
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
                const fy = options.fy || (this._model as any).loadFy || 35.53;
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
                (this._model as any).loadFy = fy;
                this._postMessage('modelLoaded', this._model);
                return { success: true };
            }

            case 'run_analysis': {
                const result = await this._pythonBridge.analyze(this._model as any);
                this._lastAnalysisResult = result;
                this._postMessage('analysisComplete', result);

                // DSM 자동 추출
                try {
                    const aFy = this._getAnalysisFy();
                    const dsmP = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: result.curve, fy: aFy, load_type: 'P',
                    });
                    const dsmM = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: result.curve, fy: aFy, load_type: 'Mxx',
                    });
                    this._postMessage('dsmResult', { P: dsmP, Mxx: dsmM });
                    return { success: true, n_lengths: result.n_lengths, dsm_P: dsmP, dsm_Mxx: dsmM };
                } catch {
                    return { success: true, n_lengths: result.n_lengths };
                }
            }

            case 'get_dsm': {
                const curve = this._lastAnalysisResult?.curve;
                if (!curve || curve.length === 0) {
                    return { error: 'No analysis result. Run analysis first.' };
                }

                const aFy = options.fy || this._getAnalysisFy();
                const dsmP = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve, fy: aFy, load_type: 'P',
                });
                const dsmM = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve, fy: aFy, load_type: 'Mxx',
                });
                return { P: dsmP, Mxx: dsmM, fy_used: aFy };
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

            case 'lap_connection': {
                const result = await this._pythonBridge.call('lap_connection', options);
                this._postMessage('lapConnectionResult', result);
                return result;
            }

            case 'check_lap_length': {
                return await this._pythonBridge.call('check_lap_length', options);
            }

            case 'design_connection': {
                const connResult = await this._pythonBridge.call('design_connection', options);
                this._postMessage('connectionResult', connResult);
                return connResult;
            }

            case 'shear_lag':
            case 'block_shear':
            case 'cold_work':
            case 'flange_curling': {
                return await this._pythonBridge.call(action, options);
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
                    fy: options.fy || 35.53,
                });
                this._postMessage('plasticResult', result);
                return result;
            }

            // --- AISI Design ---
            case 'aisi_design': {
                // 접합부는 단면성질/DSM 불필요 → 바로 호출
                if (options.member_type === 'connection') {
                    const result = await this._pythonBridge.call('aisi_design', options);
                    this._postMessage('designResult', result);
                    return result;
                }

                // 단면 정의 확인
                if (!this._model.node || this._model.node.length === 0) {
                    const err = {
                        error: 'No section defined. Please set up a section in the Preprocessor tab first (e.g., set_section_template), then run Analysis before design.',
                        member_type: options.member_type,
                    };
                    this._postMessage('designResult', err);
                    return err;
                }

                // 부재 설계: 단면 성질 + DSM 값을 자동 수집하여 설계 엔진에 전달
                const props = await this._pythonBridge.call('get_properties', {
                    node: this._model.node, elem: this._model.elem
                });
                // cutwp로 J, Cw, xo 보강
                let cutwpProps: any = {};
                try {
                    cutwpProps = await this._pythonBridge.call('cutwp', {
                        node: this._model.node, elem: this._model.elem
                    });
                } catch { /* cutwp 실패해도 진행 */ }

                const rx_calc = props.A > 0 ? Math.sqrt((props.Ixx || 0) / props.A) : 0;
                const ry_calc = props.A > 0 ? Math.sqrt((props.Izz || 0) / props.A) : 0;
                const xo_val = cutwpProps.xo ?? props.xo ?? 0;
                const ro_fallback = Math.sqrt(rx_calc ** 2 + ry_calc ** 2 + xo_val ** 2);

                // NaN 방어: ?? 연산자는 NaN을 통과시키므로 명시적으로 체크
                const safeNum = (v: any, fallback = 0) =>
                    (v != null && Number.isFinite(v)) ? v : fallback;

                const mergedProps = {
                    ...props,
                    J: safeNum(cutwpProps.J, safeNum(props.J)),
                    Cw: safeNum(cutwpProps.Cw, safeNum(props.Cw)),
                    xo: safeNum(xo_val),
                    ro: safeNum(cutwpProps.ro, ro_fallback),
                    // Python grosprop() returns Sx, Sz, rz — map to design engine names
                    Sf: props.Sx ?? (props.Ixx && props.zcg ? props.Ixx / Math.max(props.zcg, (props as any).h_web || 1) : 0),
                    Sxx: props.Sx ?? 0,
                    Sy: props.Sz ?? 0,
                    Szz: props.Sz ?? 0,
                    rx: props.rx ?? (props.A > 0 ? Math.sqrt(props.Ixx / props.A) : 0),
                    ry: props.rz ?? (props.A > 0 ? Math.sqrt(props.Izz / props.A) : 0),
                };

                // DSM 값 자동 추출
                // 해석 시 사용한 Fy로 DSM 추출 → 설계 Fy와 무관하게 정확한 Mcrl 산출
                let dsmValues: any = {};
                let dsmWarning: string | null = null;
                if (!this._lastAnalysisResult?.curve || this._lastAnalysisResult.curve.length === 0) {
                    dsmWarning = 'No analysis results. Run FSM analysis first to get Mcrl/Mcrd values. Without buckling analysis, DSM cannot reduce capacity below My.';
                } else {
                    const aFy = this._getAnalysisFy();
                    try {
                        // 압축용 DSM
                        const dsmP = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve,
                            fy: aFy, load_type: 'P',
                        });
                        // 휨용 DSM
                        const dsmM = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve,
                            fy: aFy, load_type: 'Mxx',
                        });
                        // Python dsm returns dynamic keys: Pcrl/Pcrd for P, Mxxcrl/Mxxcrd for Mxx
                        dsmValues = {
                            Pcrl: dsmP?.Pcrl ?? 0,
                            Pcrd: dsmP?.Pcrd ?? 0,
                            Py: dsmP?.Py ?? 0,
                            Mcrl: dsmM?.Mxxcrl ?? 0,
                            Mcrd: dsmM?.Mxxcrd ?? 0,
                            My: dsmM?.My_xx ?? 0,
                        };
                        if (dsmValues.Mcrl === 0 && dsmValues.Mcrd === 0) {
                            dsmWarning = 'DSM extraction found no buckling minima in curve. Check that stress distribution matches design type (bending vs compression).';
                        }
                    } catch (e: any) {
                        dsmWarning = `DSM extraction failed: ${e.message || String(e)}`;
                        console.error('[StCFSD] DSM extraction error:', e);
                    }
                }

                // 단면 기하 정보 추출 (뒤틀림좌굴 해석적 fallback용)
                const nodeArr = this._model.node;
                const elemArr = this._model.elem;
                let sectionInfo: any = {};
                if (nodeArr.length > 0 && elemArr.length > 0) {
                    const xs = nodeArr.map((n: number[]) => n[1]);
                    const zs = nodeArr.map((n: number[]) => n[2]);
                    const xMin = Math.min(...xs), xMax = Math.max(...xs);
                    const zMin = Math.min(...zs), zMax = Math.max(...zs);
                    const tArr = elemArr.map((e: number[]) => e[3]);
                    const t = tArr.length > 0 ? tArr[0] : 0;
                    sectionInfo = {
                        depth: +(zMax - zMin).toFixed(4),
                        flange_width: +((xMax - xMin) / 2).toFixed(4),  // C-section: half of total width
                        thickness: +t.toFixed(4),
                        type: (this._model as any).sectionType || 'C',
                    };
                    // 립 높이 추정: z 최소 근처에서 x ≈ 0인 노드의 z 범위
                    const lipNodes = nodeArr.filter((n: number[]) =>
                        Math.abs(n[1] - xMin) < t * 3 && n[2] < zMin + (zMax - zMin) * 0.15);
                    if (lipNodes.length >= 2) {
                        const lipZs = lipNodes.map((n: number[]) => n[2]);
                        sectionInfo.lip_depth = +(Math.max(...lipZs) - Math.min(...lipZs)).toFixed(4);
                    }
                }

                const designParams = {
                    ...options,
                    props: mergedProps,
                    dsm: dsmValues,
                    section: sectionInfo,
                };

                const result = await this._pythonBridge.call('aisi_design', designParams);
                if (dsmWarning) {
                    result.dsm_warning = dsmWarning;
                }
                this._postMessage('designResult', result);
                return result;
            }

            case 'aisi_guide': {
                const result = await this._pythonBridge.call('aisi_guide', options);
                this._postMessage('designGuide', result);
                return result;
            }

            case 'steel_grades': {
                const result = await this._pythonBridge.call('steel_grades', {});
                return result;
            }

            case 'web_crippling': {
                const result = await this._pythonBridge.call('web_crippling', options);
                return result;
            }

            case 'analyze_loads': {
                const result = await this._pythonBridge.call('analyze_loads', options);
                return result;
            }

            case 'generate_report': {
                // 리포트에 필요한 모든 데이터를 수집하여 반환
                const reportData: any = {
                    timestamp: new Date().toISOString(),
                    model_summary: this.getStatus(),
                };

                // 1. 단면 성질
                if (this._model.node && this._model.node.length > 0) {
                    try {
                        reportData.section_props = await this._pythonBridge.call('get_properties', {
                            node: this._model.node, elem: this._model.elem
                        });
                    } catch {}
                    try {
                        reportData.cutwp_props = await this._pythonBridge.call('cutwp', {
                            node: this._model.node, elem: this._model.elem
                        });
                    } catch {}
                }

                // 2. DSM 값
                if (this._lastAnalysisResult?.curve) {
                    const aFy = this._getAnalysisFy();
                    try {
                        reportData.dsm_P = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'P',
                        });
                        reportData.dsm_Mxx = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'Mxx',
                        });
                    } catch {}
                    reportData.curve_length = this._lastAnalysisResult.curve.length;
                }

                // 3. 하중 분석 (옵션)
                if (options.loads) {
                    try {
                        reportData.load_analysis = await this._pythonBridge.call('analyze_loads', options);
                    } catch {}
                }

                // 4. 설계 결과
                if (options.member_type) {
                    try {
                        const designResult = await this.handleMcpAction({ action: 'aisi_design', ...options });
                        reportData.design_result = designResult;
                    } catch {}
                }

                this._postMessage('reportGenerated', reportData);
                return reportData;
            }

            case 'capture_section_preview': {
                // WebView에 캡처 요청 → sectionPreviewResult 메시지로 응답 대기
                return new Promise((resolve) => {
                    this._previewResolve = resolve;
                    this._postMessage('captureSection', null);
                    // 타임아웃 5초
                    setTimeout(() => {
                        if (this._previewResolve) {
                            this._previewResolve({ error: 'Capture timeout' });
                            this._previewResolve = null;
                        }
                    }, 5000);
                }).then((result: any) => {
                    const path = this._lastPreviewPath;
                    return { success: true, file_path: path, ...result };
                });
            }

            case 'calc_deck_stiffness': {
                const result = await this._pythonBridge.call('calc_deck_stiffness', options);
                return result;
            }

            case 'validate_design': {
                // AI/MCP용 — 현재 모델 상태를 기반으로 검증 데이터 수집 후 반환
                const valData: any = { checks: [] };
                const node = this._model.node || [];
                const elem = this._model.elem || [];
                valData.section_defined = node.length > 0;
                valData.nnodes = node.length;
                valData.nelems = elem.length;

                // Properties
                if (node.length > 0) {
                    try {
                        valData.props = await this._pythonBridge.call('get_properties', { node, elem });
                    } catch {}
                    try {
                        valData.cutwp = await this._pythonBridge.call('cutwp', { node, elem });
                    } catch {}
                }

                // Analysis/DSM
                valData.analysis_run = !!this._lastAnalysisResult?.curve;
                if (this._lastAnalysisResult?.curve) {
                    const aFy = this._getAnalysisFy();
                    try {
                        valData.dsm_P = await this._pythonBridge.call('dsm', {
                            node, elem, curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'P',
                        });
                        valData.dsm_Mxx = await this._pythonBridge.call('dsm', {
                            node, elem, curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'Mxx',
                        });
                    } catch {}
                }

                valData.status = this.getStatus();
                this._postMessage('validationData', valData);
                return valData;
            }

            case 'apply_deck_springs': {
                // 데크 강성(kφ, kx)을 CUFSM 모델의 압축 플랜지에 스프링으로 적용
                const kphi = options.kphi || 0;
                const kx = options.kx || 0;
                const flange_node = options.flange_node; // 압축 플랜지 중앙 노드 번호

                if (!flange_node && this._model.node && this._model.node.length > 0) {
                    // 자동: 최상단 노드(정모멘트) 또는 최하단 노드(부모멘트)
                    const nodes = this._model.node;
                    const topIdx = nodes.reduce((best: number, n: any, i: number) =>
                        n[2] > (nodes[best]?.[2] ?? -Infinity) ? i : best, 0);
                    const topNodeNum = nodes[topIdx][0];

                    const springs: number[][] = [];
                    if (kx > 0) {
                        // [node, kx, kz, kq, x_off, z_off, 'foundation'=0]
                        springs.push([topNodeNum, kx, 0, 0, 0, 0, 0]);
                    }
                    if (kphi > 0) {
                        springs.push([topNodeNum, 0, 0, kphi, 0, 0, 0]);
                    }
                    (this._model as any).springs = springs;
                    return { success: true, nsprings: springs.length, node: topNodeNum };
                }
                return { success: true, nsprings: 0 };
            }

            case 'design_purlin': {
                // 퍼린 전체 설계 (analyze_loads → dual CUFSM → region-specific design)
                if (!this._model.node || this._model.node.length === 0) {
                    return { error: 'No section defined. Set up section in Preprocessor first.' };
                }

                // Step 1: 하중 분석
                const loadResult = await this._pythonBridge.call('analyze_loads', options);

                // Step 2: 데크 강성
                const deckInfo = loadResult?.auto_params?.deck || { kphi: 0, kx: 0 };
                const aFy = this._getAnalysisFy();
                const savedSprings = (this._model as any).springs || [];
                const savedNode = this._model.node.map((n: number[]) => [...n]);
                const savedElem = this._model.elem.map((e: number[]) => [...e]);

                // Step 3: 정모멘트 CUFSM (데크 스프링 ON, 단일 t)
                await this.handleMcpAction({
                    action: 'apply_deck_springs',
                    kphi: deckInfo.kphi, kx: deckInfo.kx,
                });
                const analysisPos = await this._pythonBridge.analyze(this._model);
                const dsmPos = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: analysisPos?.curve || [], fy: aFy, load_type: 'Mxx',
                });

                // Step 4: 부모멘트 CUFSM (스프링 OFF, 단일 t)
                (this._model as any).springs = [];
                const analysisNeg = await this._pythonBridge.analyze(this._model);
                const dsmNeg = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: analysisNeg?.curve || [], fy: aFy, load_type: 'Mxx',
                });

                // 스프링/단면 원복
                (this._model as any).springs = savedSprings;
                this._model.node = savedNode.map((n: number[]) => [...n]);

                // Step 5: 단면 성질
                const propsRaw = await this._pythonBridge.call('get_properties', {
                    node: this._model.node, elem: this._model.elem
                });
                let cutwp: any = {};
                try {
                    cutwp = await this._pythonBridge.call('cutwp', {
                        node: this._model.node, elem: this._model.elem
                    });
                } catch { }

                // Step 6: 정/부모멘트/Lap 별도 AISI 설계
                const fy = options.Fy || options.loads?.Fy || aFy;
                const fu = options.Fu || options.loads?.Fu || fy * 1.34;
                const dm = options.design_method || 'LRFD';
                const posRegion = loadResult?.auto_params?.positive_region || {};
                const negRegion = loadResult?.auto_params?.negative_region || {};
                const gravLocs = loadResult?.gravity?.locations || [];
                const upliftR = loadResult?.auto_params?.uplift_R ?? null;
                const hasLaps = options.laps && (options.laps.left_ft > 0 || options.laps.right_ft > 0);
                const spanType = options.span_type || 'simple';
                const isMultiSpan = spanType !== 'simple' && spanType !== 'cantilever';

                const mergedProps = { ...propsRaw, ...cutwp,
                    Sf: propsRaw.Sx ?? 0, Sxx: propsRaw.Sx ?? 0 };

                // 정모멘트 소요강도 (지배 위치)
                const posMoments = gravLocs.filter((l: any) => l.M > 0).map((l: any) => Math.abs(l.M));
                const posMu = posMoments.length > 0 ? Math.max(...posMoments) : 0;
                // 부모멘트 소요강도 (지배 위치)
                const negMoments = gravLocs.filter((l: any) => l.M < 0).map((l: any) => Math.abs(l.M));
                const negMu = negMoments.length > 0 ? Math.max(...negMoments) : 0;

                // 6a. 정모멘트 설계 (데크 브레이싱, dsmPos)
                let designPos: any = null;
                if (posMu > 0 || gravLocs.length === 0) {
                    designPos = await this._pythonBridge.call('aisi_design', {
                        member_type: 'flexure', design_method: dm,
                        Fy: fy, Fu: fu,
                        Lb: posRegion.Ly_in || 0, Cb: posRegion.Cb || 1.0,
                        Mu: posMu,
                        props: mergedProps,
                        dsm: {
                            Mcrl: dsmPos?.Mxxcrl ?? 0,
                            Mcrd: dsmPos?.Mxxcrd ?? 0,
                            My: dsmPos?.My_xx ?? 0,
                        },
                    });
                }

                // 6b. 부모멘트 설계 — Lap 끝~변곡점 구간 (비지지, dsmNeg, 단일 t)
                let designNeg: any = null;
                if (negMu > 0) {
                    designNeg = await this._pythonBridge.call('aisi_design', {
                        member_type: 'flexure', design_method: dm,
                        Fy: fy, Fu: fu,
                        Lb: negRegion.Ly_in || 0, Cb: negRegion.Cb || 1.67,
                        Mu: negMu,
                        props: mergedProps,
                        dsm: {
                            Mcrl: dsmNeg?.Mxxcrl ?? 0,
                            Mcrd: dsmNeg?.Mxxcrd ?? 0,
                            My: dsmNeg?.My_xx ?? 0,
                        },
                    });
                }

                // 6c. Lap 구간 설계 — AISI 방식: 개별 부재 Mnl 합산
                // "The strength within lapped portions is the sum of the individual members"
                // LTB/뒤틀림은 Lap 구간에서 발생하지 않는 것으로 가정 (Mne=Mnd=My)
                let designLap: any = null;
                if (isMultiSpan && negMu > 0) {
                    // 단일 부재 강도 (dsmNeg 기반, 스프링 없음)
                    const singleMnl = await this._pythonBridge.call('aisi_design', {
                        member_type: 'flexure', design_method: dm,
                        Fy: fy, Fu: fu,
                        Lb: 0, Cb: 1.0,  // Lap에서 LTB 구속
                        Mu: 0,  // 이용률 불필요
                        props: mergedProps,
                        dsm: {
                            Mcrl: dsmNeg?.Mxxcrl ?? 0,
                            Mcrd: 0,  // 뒤틀림 제외
                            My: dsmNeg?.My_xx ?? 0,
                        },
                    });
                    // Lap에서 2개 부재 겹침 → 강도 합산
                    const nLap = hasLaps ? 2 : 1;
                    const lapMn = (singleMnl?.Mn ?? 0) * nLap;
                    const lapPhiMn = (singleMnl?.phi_Mn ?? 0) * nLap;
                    const lapMnOmega = (singleMnl?.Mn_omega ?? 0) * nLap;
                    designLap = {
                        ...singleMnl,
                        Mn: Math.round(lapMn * 100) / 100,
                        phi_Mn: Math.round(lapPhiMn * 100) / 100,
                        Mn_omega: Math.round(lapMnOmega * 100) / 100,
                        design_strength: dm === 'LRFD'
                            ? Math.round(lapPhiMn * 100) / 100
                            : Math.round(lapMnOmega * 100) / 100,
                        n_members: nLap,
                        note: `Lap: ${nLap} members summed, LTB/distortional excluded`,
                        utilization: negMu > 0 && lapPhiMn > 0
                            ? Math.round(negMu / (dm === 'LRFD' ? lapPhiMn : lapMnOmega) * 10000) / 10000
                            : null,
                        pass: negMu > 0 && lapPhiMn > 0
                            ? negMu <= (dm === 'LRFD' ? lapPhiMn : lapMnOmega)
                            : null,
                    };
                }

                const result = {
                    load_analysis: loadResult,
                    dsm_positive: dsmPos,
                    dsm_negative: dsmNeg,
                    design_positive: designPos,
                    design_negative: designNeg,
                    design_lap: designLap,
                    uplift_R: upliftR,
                    props: propsRaw,
                    cutwp: cutwp,
                    deck: deckInfo,
                    span_type: spanType,
                };
                this._postMessage('designPurlinResult', result);
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
    <title>StCFSD Section Designer</title>
</head>
<body>
    <!-- 탭 바 + 파일 버튼 -->
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="preprocessor">전처리</button>
        <button class="tab-btn" data-tab="analysis">해석</button>
        <button class="tab-btn" data-tab="postprocessor">후처리</button>
        <button class="tab-btn" data-tab="design">설계</button>
        <button class="tab-btn" data-tab="connection">접합부</button>
        <button class="tab-btn" data-tab="report">보고서</button>
        <button class="tab-btn" data-tab="validation">검증</button>
        <span style="flex:1"></span>
        <button id="btn-file-open" class="btn-file" title="Open .csd file">Open</button>
        <button id="btn-file-save" class="btn-file" title="Save .csd file">Save</button>
    </div>

    <!-- 탭 내용 -->
    <div class="tab-content">
        <!-- 전처리 탭 -->
        <div id="tab-preprocessor" class="tab-panel active">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;padding:4px 6px;background:var(--vscode-editor-selectionBackground);border-radius:4px">
                <span style="font-size:11px;font-weight:600">단위계</span>
                <button id="btn-unit-US" class="btn-toggle" style="font-size:11px;padding:2px 10px;border-radius:3px;cursor:pointer">US (ksi, in)</button>
                <button id="btn-unit-SI" class="btn-toggle active" style="font-size:11px;padding:2px 10px;border-radius:3px;cursor:pointer">SI (MPa, mm)</button>
            </div>
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
                                <option value="lipped_angle">Lipped Angle (립부 앵글)</option>
                            </select>
                            <button id="btn-generate-template" class="btn-action-green" style="padding:4px 12px">Generate</button>
                        </div>
                        <div id="template-params" class="input-row" style="margin-top:4px; flex-wrap:wrap;">
                            <label>H<span class="hint-inline" data-unit="length">in</span></label><input type="number" id="tpl-H" value="3.937" step="0.5" style="width:60px">
                            <label>B<span class="hint-inline" data-unit="length">in</span></label><input type="number" id="tpl-B" value="1.969" step="0.5" style="width:60px">
                            <label>D<span class="hint-inline" data-unit="length">in</span></label><input type="number" id="tpl-D" value="0.787" step="0.1" style="width:60px">
                            <label>t<span class="hint-inline" data-unit="thickness">in</span></label><input type="number" id="tpl-t" value="0.0906" step="0.01" style="width:60px">
                            <label>r<span class="hint-inline" data-unit="radius">in</span></label><input type="number" id="tpl-r" value="0.157" step="0.1" style="width:60px">
                            <span id="tpl-qlip-group" style="display:none">
                                <label>lip°<span class="hint-inline">립각도</span></label><input type="number" id="tpl-qlip" value="90" step="5" min="0" max="180" style="width:68px">
                            </span>
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Material</label>
                        <p class="hint">강종 선택 시 Fy, Fu, E, G가 자동 설정됩니다.</p>
                        <div class="input-row">
                            <label>Steel</label>
                            <select id="input-steel-grade" style="width:110px">
                                <option value="">-- Manual --</option>
                                <option value="SGC400" selected>SGC400 (245/400 MPa)</option>
                                <option value="SGC440">SGC440 (295/440 MPa)</option>
                                <option value="SGC490">SGC490 (365/490 MPa)</option>
                                <option value="SGC570">SGC570 (560/570 MPa)</option>
                                <option value="A653-33">A653-33 (33/45 ksi)</option>
                                <option value="A653-50">A653-50 (50/65 ksi)</option>
                                <option value="A653-80">A653-80 (80/82 ksi)</option>
                            </select>
                        </div>
                        <div class="input-row">
                            <label>Fy<span class="hint-inline" data-unit="stress">ksi</span></label><input type="number" id="input-fy" value="35.53" step="1" style="width:60px">
                            <label>Fu<span class="hint-inline" data-unit="stress">ksi</span></label><input type="number" id="input-fu" value="58.02" step="1" style="width:60px">
                        </div>
                        <div class="input-row">
                            <label>E<span class="hint-inline" data-unit="stress">ksi</span></label><input type="number" id="input-E" value="29733" step="100">
                            <label>v</label><input type="number" id="input-v" value="0.3" step="0.01">
                            <label>G<span class="hint-inline" data-unit="stress">ksi</span></label><input type="number" id="input-G" value="11436" step="100">
                        </div>
                    </div>
                    <div class="section-group">
                        <label>Nodes <button id="btn-add-node" class="btn-small">+ 추가</button></label>
                        <p class="hint">절점 좌표(x, z)와 응력(stress). 해석 탭의 Load Case 선택 시 해석 실행 전에 자동 설정됩니다.</p>
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
            <div style="display:flex;gap:12px">
            <div style="flex:1;min-width:0">
            <p class="hint">유한스트립법(FSM) 좌굴 해석 설정.</p>
            <div class="section-group">
                <label>하중 케이스 (Load Case)</label>
                <p class="hint">좌굴 해석의 기준 하중 상태. 휨 방향(+/-)은 단면 좌표축 기준.</p>
                <div class="input-row" style="flex-wrap:wrap;">
                    <select id="select-load-case" style="width:180px">
                        <option value="compression" selected>압축 (Compression)</option>
                        <option value="bending_xx_pos">강축 휨 +Mxx (z+ 압축)</option>
                        <option value="bending_xx_neg">강축 휨 -Mxx (z- 압축)</option>
                        <option value="bending_zz_pos">약축 휨 +Mzz (x+ 압축)</option>
                        <option value="bending_zz_neg">약축 휨 -Mzz (x- 압축)</option>
                        <option value="custom">조합 (P + Mxx + Mzz)</option>
                    </select>
                    <span class="hint" style="margin-left:8px" id="analysis-fy-display">Fy: 35.53 ksi</span>
                </div>
                <div id="custom-load-inputs" class="input-row" style="display:none; margin-top:4px;">
                    <label>P<span class="hint-inline" data-unit="force">kips</span></label>
                    <input type="number" id="input-load-P" value="0" step="1" style="width:70px">
                    <label>Mxx<span class="hint-inline" data-unit="moment">kip-in</span></label>
                    <input type="number" id="input-load-Mxx" value="0" step="10" style="width:70px">
                    <label>Mzz<span class="hint-inline" data-unit="moment">kip-in</span></label>
                    <input type="number" id="input-load-Mzz" value="0" step="10" style="width:70px">
                </div>
            </div>
            <div class="section-group">
                <label>경계조건 (Boundary Condition)</label>
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
                <label>반파장 범위 (Half-Wavelength)</label>
                <p class="hint">좌굴 곡선의 x축 범위를 설정합니다. 각 좌굴 모드가 서로 다른 반파장 영역에서 나타납니다.</p>
                <p class="hint" style="margin-top:2px"><b>최솟값</b>: 국부좌굴을 포착하기 위한 하한. 일반적으로 <b>단면 최대 판폭</b> 이하로 설정합니다. 예: 웹 높이 230mm인 C형강 → 최소 ~25mm. 너무 크면 국부좌굴 곡선이 잘립니다.</p>
                <p class="hint" style="margin-top:2px"><b>최댓값</b>: 전체좌굴(LTB, 유연좌굴)을 포착하기 위한 상한. <b>부재의 비지지 길이 이상</b>으로 설정해야 합니다. 예: 지점간격 5m → 최대 ≥ 5000mm (5m). 일반적으로 비지지 길이의 1.5~3배를 권장합니다.</p>
                <p class="hint" style="margin-top:2px"><b>개수</b>: 곡선의 해상도. 50점이면 대부분 충분하며, 복잡한 단면은 80~100점 권장.</p>
                <div class="input-row">
                    <label>최소<span class="hint-inline" data-unit="length">in</span></label><input type="number" id="input-len-min" value="0.394" step="1">
                    <label>최대<span class="hint-inline" data-unit="length">in</span></label><input type="number" id="input-len-max" value="393.7" step="100">
                    <label>개수</label><input type="number" id="input-len-n" value="60" step="10">
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
            </div>
            <!-- 우측: 응력 분포 프리뷰 -->
            <div style="width:200px;flex-shrink:0">
                <label style="font-weight:600;font-size:12px">응력 분포 프리뷰</label>
                <p class="hint" style="margin:2px 0 4px">선택한 Load Case의 절점 응력 분포</p>
                <div id="stress-preview" style="border:1px solid var(--vscode-panel-border);border-radius:4px;background:var(--vscode-editor-background);min-height:180px;display:flex;align-items:center;justify-content:center">
                    <svg id="stress-preview-svg" width="190" height="220" viewBox="0 0 190 220"></svg>
                </div>
                <div id="stress-legend" style="font-size:9px;margin-top:4px;color:var(--vscode-descriptionForeground)">
                    <span style="color:#ef5350">■ 압축(-)</span>&nbsp;
                    <span style="color:#42a5f5">■ 인장(+)</span>
                </div>
            </div>
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
                        <label>fy<span class="hint-inline" data-unit="stress">ksi</span></label><input type="number" id="plastic-fy" value="35.53" step="5" style="width:60px">
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
    <!-- ========== Design Tab ========== -->
    <div id="tab-design" class="tab-panel">
        <!-- Step Indicator -->
        <div class="step-indicator" id="design-step-indicator">
            <div class="step-item active" data-step="1"><span class="step-num">1</span><span>Inputs</span></div>
            <div class="step-line" id="step-line-12"></div>
            <div class="step-item" data-step="2" id="step-item-2"><span class="step-num">2</span><span>Loads</span></div>
            <div class="step-line" id="step-line-23"></div>
            <div class="step-item" data-step="3"><span class="step-num">3</span><span>Design</span></div>
        </div>
        <div class="panel-row">
            <div class="panel-left" style="max-width:360px">
                <h3 class="collapsible" id="sec-material" data-expanded="true"><span class="collapse-icon">▾</span> Material <span class="hint-inline" style="font-weight:normal">(전처리 탭에서 설정)</span></h3>
                <div id="sec-material-body">
                <div class="input-row">
                    <label>Fy<span class="hint-inline" data-unit="stress">ksi</span></label>
                    <input type="number" id="design-fy" value="35.53" style="width:68px" readonly tabindex="-1" class="input-readonly">
                    <label>Fu<span class="hint-inline" data-unit="stress">ksi</span></label>
                    <input type="number" id="design-fu" value="58.02" style="width:68px" readonly tabindex="-1" class="input-readonly">
                </div>
                </div>

                <h3 class="collapsible" id="sec-method" data-expanded="true"><span class="collapse-icon">▾</span> 설계 방법</h3>
                <div id="sec-method-body">
                <div class="input-row">
                    <select id="select-design-method" style="width:130px">
                        <option value="LRFD">LRFD (φRn≥Ru)</option>
                        <option value="ASD">ASD (Rn/Ω≥Ra)</option>
                    </select>
                    <select id="select-analysis-method" style="width:130px">
                        <option value="DSM">DSM</option>
                    </select>
                </div>
                </div>

                <h3>부재 유형</h3>
                <div class="input-row">
                    <select id="select-member-type">
                        <optgroup label="적용 (자동 계산)">
                            <option value="roof-purlin">지붕 퍼린 (Roof Purlin)</option>
                            <option value="floor-joist">바닥 장선 (Floor Joist)</option>
                            <option value="wall-girt">벽체 거트 (Wall Girt)</option>
                            <option value="wall-stud">벽 스터드 (Wall Stud)</option>
                        </optgroup>
                        <optgroup label="일반 (직접 입력)">
                            <option value="flexure">일반 보 (휨)</option>
                            <option value="compression">일반 기둥 (압축)</option>
                            <option value="combined">보-기둥 (조합)</option>
                            <option value="tension">인장 부재</option>
                        </optgroup>
                    </select>
                </div>

                <div id="calc-mode-section" style="display:none">
                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> 부재 구성</h3>
                <div>
                    <div class="input-row">
                        <label>스팬 유형</label>
                        <select id="select-span-type" style="width:140px">
                            <option value="simple">단순보</option>
                            <option value="cantilever">캔틸레버</option>
                            <option value="cont-2">2경간 연속보</option>
                            <option value="cont-3" selected>3경간 연속보</option>
                            <option value="cont-4">4경간 연속보</option>
                            <option value="cont-n">N경간 연속보</option>
                        </select>
                        <input type="number" id="config-n-spans" value="5" min="2" max="20" step="1" style="width:55px;display:none" title="경간 수">
                        <label>간격<span class="hint-inline" data-unit="length_ft">ft</span></label>
                        <input type="number" id="config-spacing" value="3.281" step="0.5" style="width:68px">
                    </div>

                    <!-- 스팬/지점/랩 테이블 -->
                    <div id="span-table-container" style="margin-top:6px;overflow-x:auto">
                        <table id="span-config-table" style="width:100%;font-size:10px;border-collapse:collapse;border:1px solid var(--vscode-panel-border)">
                            <thead>
                                <tr style="background:var(--vscode-editor-selectionBackground)">
                                    <th style="padding:3px 4px;width:32px">#</th>
                                    <th style="padding:3px 4px;width:60px">지점</th>
                                    <th style="padding:3px 4px;width:70px">스팬(<span data-unit="length_ft">ft</span>)</th>
                                    <th style="padding:3px 4px;width:60px">랩L(<span data-unit="length_ft">ft</span>)</th>
                                    <th style="padding:3px 4px;width:60px">랩R(<span data-unit="length_ft">ft</span>)</th>
                                </tr>
                            </thead>
                            <tbody id="span-config-tbody">
                                <!-- JS에서 동적 생성 -->
                            </tbody>
                        </table>
                        <p class="hint" style="font-size:9px;margin-top:2px">지점: P=핀, R=롤러, F=고정단, N=자유단. 랩=지점 양측 겹침 길이.</p>
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> 사용 하중</h3>
                <div>
                    <div class="input-row">
                        <label>D<span class="hint-inline" data-unit="pressure">psf</span></label>
                        <input type="number" id="load-D-psf" value="6.265" step="0.5" style="width:50px">
                        <span id="load-D-plf" class="hint-inline" style="min-width:50px">→15 PLF</span>
                    </div>
                    <div class="input-row" id="load-Lr-row">
                        <label>Lr<span class="hint-inline" data-unit="pressure">psf</span></label>
                        <input type="number" id="load-Lr-psf" value="20.885" step="1" style="width:50px">
                        <span id="load-Lr-plf" class="hint-inline" style="min-width:50px">→100 PLF</span>
                    </div>
                    <div class="input-row" id="load-S-row">
                        <label>S<span class="hint-inline" data-unit="pressure">psf</span></label>
                        <input type="number" id="load-S-psf" value="10.443" step="1" style="width:50px">
                        <span id="load-S-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                    <div class="input-row" id="load-W-row">
                        <label>Wu<span class="hint-inline" data-unit="pressure">psf</span>↑</label>
                        <input type="number" id="load-Wu-psf" value="20.885" step="1" style="width:50px">
                        <span id="load-Wu-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                    <div class="input-row" id="load-L-row" style="display:none">
                        <label>L<span class="hint-inline" data-unit="pressure">psf</span></label>
                        <input type="number" id="load-L-psf" value="0" step="1" style="width:50px">
                        <span id="load-L-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="false"><span class="collapse-icon">▸</span> 데크 & 가새</h3>
                <div style="display:none">
                    <div class="input-row">
                        <label>데크</label>
                        <select id="select-deck-type" style="width:140px">
                            <option value="through-fastened">관통 체결</option>
                            <option value="standing-seam">스탠딩 심</option>
                            <option value="none">없음</option>
                        </select>
                    </div>
                    <div class="input-row" id="deck-detail-row">
                        <label>t<span class="hint-inline" data-unit="length">in</span></label>
                        <input type="number" id="deck-t-panel" value="0.0197" step="0.001" style="width:68px">
                        <label>@<span class="hint-inline" data-unit="length">in</span></label>
                        <input type="number" id="deck-fastener-spacing" value="11.81" step="1" style="width:55px">
                    </div>
                    <div class="input-row" id="deck-kphi-row">
                        <label>kφ override<span class="hint-inline" data-unit="rotStiff">kip-in/rad/in</span></label>
                        <input type="number" id="deck-kphi-override" value="" step="0.001" style="width:70px" placeholder="auto">
                    </div>
                </div>

                <button id="btn-analyze-loads" class="btn-action-green" style="margin-top:8px;width:100%">하중 분석 실행</button>
                </div>

                <h3 id="design-lengths-title">비지지 길이</h3>
                <div class="input-row" id="design-KxLx-row">
                    <label>KxLx<span class="hint-inline" data-unit="length">in</span></label>
                    <input type="number" id="design-KxLx" value="118.11" step="1" style="width:65px">
                    <label>KyLy<span class="hint-inline" data-unit="length">in</span></label>
                    <input type="number" id="design-KyLy" value="118.11" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-KtLt-row">
                    <label>KtLt<span class="hint-inline" data-unit="length">in</span></label>
                    <input type="number" id="design-KtLt" value="118.11" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-Cb-row">
                    <label>Cb</label>
                    <input type="number" id="design-Cb" value="1.0" step="0.01" style="width:65px">
                </div>
                <div class="input-row" id="design-Lb-row">
                    <label>Lb<span class="hint-inline" data-unit="length">in</span> (LTB)</label>
                    <input type="number" id="design-Lb" value="118.11" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-Cm-row" style="display:none">
                    <label>Cmx</label>
                    <input type="number" id="design-Cmx" value="0.85" step="0.01" style="width:68px">
                    <label>Cmy</label>
                    <input type="number" id="design-Cmy" value="0.85" step="0.01" style="width:68px">
                </div>

                <h3>소요 하중</h3>
                <div class="input-row">
                    <label>P<span class="hint-inline" data-unit="force">kips</span></label>
                    <input type="number" id="design-P" value="0" step="0.1" style="width:65px">
                    <label>V<span class="hint-inline" data-unit="force">kips</span></label>
                    <input type="number" id="design-V" value="0" step="0.1" style="width:65px">
                </div>
                <div class="input-row">
                    <label>Mx<span class="hint-inline" data-unit="moment">kip-in</span></label>
                    <input type="number" id="design-Mx" value="0" step="0.1" style="width:65px">
                    <label>My<span class="hint-inline" data-unit="moment">kip-in</span></label>
                    <input type="number" id="design-My" value="0" step="0.1" style="width:65px">
                </div>

                <div id="design-wc-section" style="display:none">
                    <h3>웹 크리플링 (§G5)</h3>
                    <div class="input-row">
                        <label>N<span class="hint-inline" data-unit="length">in</span></label>
                        <input type="number" id="design-wc-N" value="3.504" step="0.1" style="width:68px">
                        <label>R<span class="hint-inline" data-unit="length">in</span></label>
                        <input type="number" id="design-wc-R" value="0.1875" step="0.01" style="width:65px">
                    </div>
                    <div class="input-row">
                        <label>지점 조건</label>
                        <select id="design-wc-support" style="width:120px">
                            <option value="EOF">EOF (단부 1면)</option>
                            <option value="IOF">IOF (내부 1면)</option>
                            <option value="ETF">ETF (단부 2면)</option>
                            <option value="ITF">ITF (내부 2면)</option>
                        </select>
                    </div>
                </div>

                <div class="section-group" style="margin-top:10px; padding:6px 8px; border:1px solid var(--vscode-panel-border); border-radius:3px;">
                    <label style="font-size:12px; font-weight:600;">고급 옵션</label>
                    <div class="input-row" style="margin-top:4px">
                        <label><input type="checkbox" id="chk-inelastic-reserve"> §F2.4.2 Inelastic Reserve</label>
                        <span class="hint-inline">(Mne: My→Mp, deck braced 시)</span>
                    </div>
                    <div class="input-row" style="margin-top:4px">
                        <label><input type="checkbox" id="chk-cold-work"> §A3.3.2 Cold Work (냉간가공 Fya)</label>
                        <span class="hint-inline">(코너부 강도 증가)</span>
                    </div>
                    <div class="input-row" style="margin-top:4px">
                        <label><input type="checkbox" id="chk-r-factor"> §I6.2.1 R-factor (양력)</label>
                        <select id="select-r-value" style="width:auto; font-size:11px; margin-left:4px">
                            <option value="0">미적용</option>
                            <option value="0.70">0.70 — C/Z ≤6.5in simple</option>
                            <option value="0.65">0.65 — C/Z 6.5~8.5in simple</option>
                            <option value="0.50">0.50 — Z 8.5~12in simple</option>
                            <option value="0.40">0.40 — C 8.5~12in simple</option>
                            <option value="0.60" selected>0.60 — C continuous</option>
                            <option value="0.70">0.70 — Z continuous</option>
                        </select>
                    </div>
                    <p class="hint" style="margin:2px 0 0 20px">Through-fastened panel + 양력 시: Mn = R × Mnfo</p>
                </div>

                <button id="btn-run-design" class="btn-primary" style="margin-top:12px;width:100%">▶ 설계 검토 실행</button>
                <p class="hint" style="margin-top:6px">자동 DSM 좌굴값 적용을 위해 먼저 해석을 실행하세요.</p>
            </div>

            <div class="panel-right">
                <div id="load-analysis-section" style="display:none">
                <h3>하중 분석 결과</h3>
                <div id="load-analysis-result" class="result-box" style="max-height:300px;overflow-y:auto;font-size:12px">
                </div>
                </div>

                <h3>설계 요약</h3>
                <div id="design-loading" class="loading-overlay" style="display:none">
                    <div class="loading-spinner"></div><span>계산 중...</span>
                </div>
                <div id="design-summary" class="result-box" style="min-height:80px">
                    <p class="hint">설계 검토를 실행하면 결과가 표시됩니다</p>
                </div>

                <h3>단계별 계산</h3>
                <div id="design-steps" class="result-box" style="max-height:450px;overflow-y:auto">
                </div>

                <h3 id="design-interaction-title" style="display:none">조합 검토 (H1.2)</h3>
                <div id="design-interaction" class="result-box" style="display:none">
                </div>

                <h3>규준 참조</h3>
                <div id="design-reference" class="result-box">
                    <p class="hint">AISI S100-16 해당 조항이 여기에 표시됩니다</p>
                </div>
                <button id="btn-copy-report" class="btn-secondary" style="margin-top:8px;width:100%;display:none">보고서 클립보드 복사</button>
            </div>
        </div>
    </div>

    <!-- 접합부 (Connection) 탭 -->
    <div id="tab-connection" class="tab-panel">
        <div class="panel-row">
            <!-- ━━━ 왼쪽: 입력 ━━━ -->
            <div class="panel-left" style="max-width:380px">

                <!-- ── Lap Splice ── -->
                <div class="collapsible" onclick="this.classList.toggle('open');this.nextElementSibling.style.display=this.classList.contains('open')?'block':'none'">
                    <span style="font-size:11px">▶</span> Lap Splice 접합부 <span class="hint-inline">§I6.2.1, §J3, §J4</span>
                </div>
                <div style="display:none;padding:4px 0 8px 0">
                    <p class="hint" style="margin-bottom:6px">연속 경간 Lap의 패스너 개수/배치를 산정합니다.</p>
                    <div class="input-row"><label style="min-width:56px;text-align:right">좌측 Lap</label><input type="number" id="conn-lap-left" value="305" step="10" style="width:72px"><span class="hint-inline conn-unit-length"></span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">우측 Lap</label><input type="number" id="conn-lap-right" value="305" step="10" style="width:72px"><span class="hint-inline conn-unit-length"></span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">지점 Mu</label><input type="number" id="conn-Mu" value="0" step="0.1" style="width:72px" data-unit="moment"><span class="hint-inline conn-unit-moment"></span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">지점 Vu</label><input type="number" id="conn-Vu" value="0" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force"></span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">패스너</label>
                        <select id="conn-fastener-type" style="font-size:12px"><option value="screw" selected>Screw</option><option value="bolt">Bolt</option></select>
                        <label>d</label><input type="number" id="conn-fastener-dia" value="4.8" step="0.1" style="width:56px"><span class="hint-inline conn-unit-length"></span>
                    </div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">행 수</label><input type="number" id="conn-n-rows" value="2" min="1" max="4" step="1" style="width:56px"></div>
                    <button id="btn-run-lap-design" class="btn-action-green" style="margin-top:8px;width:100%;padding:6px">Lap 접합부 설계</button>
                </div>

                <!-- ── 단일 접합부 ── -->
                <div class="collapsible open" onclick="this.classList.toggle('open');this.nextElementSibling.style.display=this.classList.contains('open')?'block':'none'">
                    <span style="font-size:11px">▼</span> 단일 접합부 설계 <span class="hint-inline">Chapter J — 7종</span>
                </div>
                <div style="padding:4px 0 8px 0">
                    <div class="input-row" style="margin-bottom:6px">
                        <label style="min-width:56px;text-align:right">유형</label>
                        <select id="conn-single-type" style="font-size:12px;flex:1">
                            <optgroup label="기계적 접합">
                                <option value="screw">Screw — 나사 (§J4)</option>
                                <option value="bolt">Bolt — 볼트 (§J3)</option>
                                <option value="paf">PAF — 화약고정 (§J5)</option>
                            </optgroup>
                            <optgroup label="용접 접합">
                                <option value="fillet_weld">Fillet Weld — 필릿 (§J2.1)</option>
                                <option value="arc_spot">Arc Spot — 아크점 (§J2.2)</option>
                                <option value="arc_seam">Arc Seam — 아크심 (§J2.4)</option>
                                <option value="groove">Groove — 그루브 (§J2.3)</option>
                            </optgroup>
                        </select>
                    </div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">t1</label><input type="number" id="conn-t1" value="1.5" step="0.1" style="width:72px" data-unit="thickness"><label>t2</label><input type="number" id="conn-t2" value="1.5" step="0.1" style="width:72px" data-unit="thickness"><span class="hint-inline conn-unit-thickness"></span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">직경 d</label><input type="number" id="conn-d" value="4.8" step="0.1" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length"></span><label>개수 n</label><input type="number" id="conn-n" value="4" min="1" step="1" style="width:56px"></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">Fy</label><input type="number" id="conn-Fy" value="245" step="10" style="width:72px" data-unit="stress"><label>Fu</label><input type="number" id="conn-Fu" value="400" step="10" style="width:72px" data-unit="stress"><span class="hint-inline conn-unit-stress"></span></div>
                    <div class="input-row" id="conn-weld-row" style="display:none"><label style="min-width:56px;text-align:right">용접길이</label><input type="number" id="conn-weld-L" value="50" step="1" style="width:72px" data-unit="length"><label>크기</label><input type="number" id="conn-weld-size" value="3" step="0.5" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length"></span></div>
                    <div class="input-row" id="conn-groove-row" style="display:none"><label style="min-width:56px;text-align:right">그루브</label><select id="conn-groove-type" style="font-size:12px"><option value="complete">완전용입 CJP</option><option value="partial">부분용입 PJP</option></select></div>
                    <div class="input-row" id="conn-bolt-row" style="display:none"><label style="min-width:56px;text-align:right">Fub</label><input type="number" id="conn-Fub" value="827" step="10" style="width:72px" data-unit="stress"><span class="hint-inline conn-unit-stress">볼트 인장강도</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">Pu</label><input type="number" id="conn-Pu" value="0" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force">소요 강도</span></div>
                    <button id="btn-run-single-conn" class="btn-action-green" style="margin-top:8px;width:100%;padding:6px">접합부 강도 계산</button>
                </div>

            </div>

            <!-- ━━━ 오른쪽: 결과 ━━━ -->
            <div class="panel-right">
                <h3>접합부 설계 결과</h3>
                <div id="connection-result" class="props-display" style="min-height:200px">
                    <em style="opacity:0.5">왼쪽에서 접합부 유형을 선택하고 설계를 실행하세요.</em>
                </div>
            </div>
        </div>
    </div>

    <!-- Report 탭 -->
    <div id="tab-report" class="tab-panel">
        <div style="display:flex;gap:8px;margin-bottom:8px">
            <button id="btn-generate-report" class="btn-primary" style="flex:1">상세 보고서 생성</button>
            <button id="btn-print-report" class="btn-secondary" style="width:100px;display:none">인쇄</button>
        </div>
        <div id="report-container" style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:16px;min-height:200px;max-height:calc(100vh - 100px);overflow-y:auto">
            <p class="hint" style="text-align:center;padding:40px 0">먼저 설계 검토를 실행한 후, "상세 보고서 생성" 버튼을 클릭하여 계산서를 생성하세요.</p>
        </div>
    </div>

    <!-- Validation 탭 -->
    <div id="tab-validation" class="tab-panel">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <button id="btn-run-validation" class="btn-primary" style="flex:1">설계 검증 실행</button>
            <span id="validation-summary-badge" style="font-size:12px;font-weight:600"></span>
        </div>
        <div id="validation-container" style="max-height:calc(100vh - 100px);overflow-y:auto">
            <p class="hint" style="text-align:center;padding:40px 0">"설계 검증 실행" 버튼을 클릭하여 모든 입력값과 결과를 AISI S100-16 요구사항과 대조 검증합니다.</p>
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

    /** 프로젝트 저장 (.csd) */
    private async _saveProject(designData?: any): Promise<void> {
        const uri = await vscode.window.showSaveDialog({
            filters: { 'StCFSD Section Design': ['csd'] },
            saveLabel: 'Save Project',
        });
        if (!uri) return;

        const projectData: any = {
            version: '1.1',
            format: 'cufsm-section-design',
            timestamp: new Date().toISOString(),
            model: this._model,
            analysisResult: this._lastAnalysisResult ? {
                curve: this._lastAnalysisResult.curve,
            } : null,
            // Design 탭 입력값 (WebView에서 수집됨)
            designInputs: designData || null,
        };

        // DSM 값 추출 (있으면)
        if (this._lastAnalysisResult?.curve && this._model.node?.length > 0) {
            try {
                const aFy = this._getAnalysisFy();
                const dsmP = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'P',
                });
                const dsmM = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: this._lastAnalysisResult.curve, fy: aFy, load_type: 'Mxx',
                });
                projectData.dsm = { P: dsmP, Mxx: dsmM };
            } catch {}
        }

        // 단면 성질
        if (this._model.node?.length > 0) {
            try {
                projectData.properties = await this._pythonBridge.call('get_properties', {
                    node: this._model.node, elem: this._model.elem,
                });
            } catch {}
        }

        const fs = require('fs');
        const json = JSON.stringify(projectData, null, 2);
        fs.writeFileSync(uri.fsPath, json, 'utf-8');
        vscode.window.showInformationMessage(`Project saved: ${uri.fsPath}`);
    }

    /** 프로젝트 열기 (.csd) */
    private async _openProject(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            filters: { 'StCFSD Section Design': ['csd'] },
            canSelectMany: false,
            openLabel: 'Open Project',
        });
        if (!uris || uris.length === 0) return;

        const fs = require('fs');
        const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
        let projectData: any;
        try {
            projectData = JSON.parse(raw);
        } catch (e) {
            vscode.window.showErrorMessage('Invalid .csd file format');
            return;
        }

        if (!projectData.model) {
            vscode.window.showErrorMessage('No model data in file');
            return;
        }

        // 모델 복원
        this._model = { ...this._model, ...projectData.model };
        this._postMessage('modelLoaded', this._model);
        this._updateTreeView();

        // 해석 결과 복원
        if (projectData.analysisResult) {
            this._lastAnalysisResult = projectData.analysisResult;
            this._postMessage('analysisComplete', projectData.analysisResult);
            if (projectData.dsm) {
                this._postMessage('dsmResult', projectData.dsm);
            }
        }

        // 단면 성질 복원
        if (projectData.properties) {
            this._postMessage('propertiesResult', projectData.properties);
        }

        // Design 탭 입력값 복원
        if (projectData.designInputs) {
            this._postMessage('restoreDesignInputs', projectData.designInputs);
        }

        vscode.window.showInformationMessage(`Project loaded: ${uris[0].fsPath}`);
    }

    private _dispose(): void {
        StcfsdPanel.currentPanel = undefined;
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
