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
                let dsmValues: any = {};
                try {
                    const fy = options.Fy || 50;
                    // 압축용 DSM
                    const dsmP = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: this._lastAnalysisResult?.curve || [],
                        fy, load_type: 'P',
                    });
                    // 휨용 DSM
                    const dsmM = await this._pythonBridge.call('dsm', {
                        node: this._model.node, elem: this._model.elem,
                        curve: this._lastAnalysisResult?.curve || [],
                        fy, load_type: 'Mxx',
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
                } catch { /* 해석 미실행 시 DSM 없이 진행 */ }

                const designParams = {
                    ...options,
                    props: mergedProps,
                    dsm: dsmValues,
                };

                const result = await this._pythonBridge.call('aisi_design', designParams);
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
                    const fy = options.Fy || 50;
                    try {
                        reportData.dsm_P = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve, fy, load_type: 'P',
                        });
                        reportData.dsm_Mxx = await this._pythonBridge.call('dsm', {
                            node: this._model.node, elem: this._model.elem,
                            curve: this._lastAnalysisResult.curve, fy, load_type: 'Mxx',
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
                    const fy = options.Fy || 50;
                    try {
                        valData.dsm_P = await this._pythonBridge.call('dsm', {
                            node, elem, curve: this._lastAnalysisResult.curve, fy, load_type: 'P',
                        });
                        valData.dsm_Mxx = await this._pythonBridge.call('dsm', {
                            node, elem, curve: this._lastAnalysisResult.curve, fy, load_type: 'Mxx',
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
                // 퍼린 전체 설계 (analyze_loads → dual CUFSM → aisi_design)
                if (!this._model.node || this._model.node.length === 0) {
                    return { error: 'No section defined. Set up section in Preprocessor first.' };
                }

                // Step 1: 하중 분석
                const loadResult = await this._pythonBridge.call('analyze_loads', options);

                // Step 2: 데크 강성
                const deckInfo = loadResult?.auto_params?.deck || { kphi: 0, kx: 0 };

                // Step 3: 정모멘트 CUFSM (데크 스프링 ON)
                const savedSprings = (this._model as any).springs || [];
                await this.handleMcpAction({
                    action: 'apply_deck_springs',
                    kphi: deckInfo.kphi, kx: deckInfo.kx,
                });
                const analysisPos = await this._pythonBridge.analyze(this._model);
                const fy = options.Fy || options.loads?.Fy || 55;
                const dsmPos = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: analysisPos?.curve || [], fy, load_type: 'Mxx',
                });

                // Step 4: 부모멘트 CUFSM (스프링 OFF)
                (this._model as any).springs = [];
                const analysisNeg = await this._pythonBridge.analyze(this._model);
                const dsmNeg = await this._pythonBridge.call('dsm', {
                    node: this._model.node, elem: this._model.elem,
                    curve: analysisNeg?.curve || [], fy, load_type: 'Mxx',
                });

                // 스프링 원복
                (this._model as any).springs = savedSprings;

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

                const result = {
                    load_analysis: loadResult,
                    dsm_positive: dsmPos,
                    dsm_negative: dsmNeg,
                    props: propsRaw,
                    cutwp: cutwp,
                    deck: deckInfo,
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
    <title>CUFSM Section Designer</title>
</head>
<body>
    <!-- 탭 바 -->
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="preprocessor">Preprocessor</button>
        <button class="tab-btn" data-tab="analysis">Analysis</button>
        <button class="tab-btn" data-tab="postprocessor">Postprocessor</button>
        <button class="tab-btn" data-tab="design">Design</button>
        <button class="tab-btn" data-tab="report">Report</button>
        <button class="tab-btn" data-tab="validation">Validation</button>
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
                                <option value="lipped_angle">Lipped Angle (립부 앵글)</option>
                            </select>
                            <button id="btn-generate-template" class="btn-small">생성</button>
                        </div>
                        <div id="template-params" class="input-row" style="margin-top:4px; flex-wrap:wrap;">
                            <label>H<span class="hint-inline">높이</span></label><input type="number" id="tpl-H" value="9" step="0.5" style="width:60px">
                            <label>B<span class="hint-inline">폭</span></label><input type="number" id="tpl-B" value="5" step="0.5" style="width:60px">
                            <label>D<span class="hint-inline">립</span></label><input type="number" id="tpl-D" value="1" step="0.1" style="width:60px">
                            <label>t<span class="hint-inline">두께</span></label><input type="number" id="tpl-t" value="0.1" step="0.01" style="width:60px">
                            <label>r<span class="hint-inline">반경</span></label><input type="number" id="tpl-r" value="0" step="0.1" style="width:60px">
                            <span id="tpl-qlip-group" style="display:none">
                                <label>lip°<span class="hint-inline">립각도</span></label><input type="number" id="tpl-qlip" value="90" step="5" min="0" max="180" style="width:55px">
                            </span>
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
                <h3 class="collapsible" id="sec-material" data-expanded="true"><span class="collapse-icon">▾</span> Material</h3>
                <div id="sec-material-body">
                <div class="input-row">
                    <label>Steel Grade</label>
                    <select id="select-steel-grade">
                        <option value="custom">Custom</option>
                        <optgroup label="ASTM A653 (Galvanized)">
                            <option value="A653-33">A653 Gr.33 (33/45)</option>
                            <option value="A653-50" selected>A653 Gr.50 (50/65)</option>
                            <option value="A653-55">A653 Gr.55 (55/70)</option>
                            <option value="A653-80">A653 Gr.80 (80/82)</option>
                        </optgroup>
                        <optgroup label="ASTM A792 (Al-Zn)">
                            <option value="A792-33">A792 Gr.33 (33/45)</option>
                            <option value="A792-50">A792 Gr.50 (50/65)</option>
                            <option value="A792-80">A792 Gr.80 (80/82)</option>
                        </optgroup>
                        <optgroup label="ASTM A1003 (Structural)">
                            <option value="A1003-33">A1003 SS-33 (33/45)</option>
                            <option value="A1003-50">A1003 SS-50 (50/65)</option>
                        </optgroup>
                    </select>
                </div>
                <div class="input-row">
                    <label>Fy<span class="hint-inline">ksi</span></label>
                    <input type="number" id="design-fy" value="50" step="1" style="width:55px" min="1" max="100">
                    <label>Fu<span class="hint-inline">ksi</span></label>
                    <input type="number" id="design-fu" value="65" step="1" style="width:55px" min="1" max="120">
                </div>
                </div>

                <h3 class="collapsible" id="sec-method" data-expanded="true"><span class="collapse-icon">▾</span> Design Method</h3>
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

                <h3>Member Type</h3>
                <div class="input-row">
                    <select id="select-member-type">
                        <optgroup label="Application (Calculator)">
                            <option value="roof-purlin">Roof Purlin (지붕 퍼린)</option>
                            <option value="floor-joist">Floor Joist (바닥 장선)</option>
                            <option value="wall-girt">Wall Girt (벽체 거트)</option>
                            <option value="wall-stud">Wall Stud (벽 스터드)</option>
                        </optgroup>
                        <optgroup label="General (Direct Input)">
                            <option value="flexure">General Beam (휨)</option>
                            <option value="compression">General Column (압축)</option>
                            <option value="combined">Beam-Column (조합)</option>
                            <option value="tension">Tension (인장)</option>
                        </optgroup>
                    </select>
                </div>

                <div id="calc-mode-section" style="display:none">
                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> Member Configuration</h3>
                <div>
                    <div class="input-row">
                        <label>Span Type</label>
                        <select id="select-span-type" style="width:140px">
                            <option value="simple">Simple Span</option>
                            <option value="cantilever">Cantilever</option>
                            <option value="cont-2">2-Span Cont.</option>
                            <option value="cont-3">3-Span Cont.</option>
                            <option value="cont-4" selected>4-Span Cont.</option>
                            <option value="cont-n">N-Span Cont.</option>
                        </select>
                        <input type="number" id="config-n-spans" value="5" min="2" max="20" step="1" style="width:40px;display:none" title="Number of spans">
                    </div>
                    <div class="input-row">
                        <label>Span<span class="hint-inline">ft</span></label>
                        <input type="number" id="config-span" value="25" step="0.5" style="width:55px">
                        <label>Spacing<span class="hint-inline">ft</span></label>
                        <input type="number" id="config-spacing" value="5" step="0.5" style="width:55px">
                    </div>
                    <div class="input-row" id="config-lap-row">
                        <label>Lap L<span class="hint-inline">ft</span></label>
                        <input type="number" id="config-lap-left" value="1.25" step="0.25" style="width:50px">
                        <label>Lap R<span class="hint-inline">ft</span></label>
                        <input type="number" id="config-lap-right" value="2.75" step="0.25" style="width:50px">
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> Service Loads</h3>
                <div>
                    <div class="input-row">
                        <label>D<span class="hint-inline">psf</span></label>
                        <input type="number" id="load-D-psf" value="3" step="0.5" style="width:50px">
                        <span id="load-D-plf" class="hint-inline" style="min-width:50px">→15 PLF</span>
                    </div>
                    <div class="input-row" id="load-Lr-row">
                        <label>Lr<span class="hint-inline">psf</span></label>
                        <input type="number" id="load-Lr-psf" value="20" step="1" style="width:50px">
                        <span id="load-Lr-plf" class="hint-inline" style="min-width:50px">→100 PLF</span>
                    </div>
                    <div class="input-row" id="load-S-row">
                        <label>S<span class="hint-inline">psf</span></label>
                        <input type="number" id="load-S-psf" value="0" step="1" style="width:50px">
                        <span id="load-S-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                    <div class="input-row" id="load-W-row">
                        <label>Wu<span class="hint-inline">psf↑</span></label>
                        <input type="number" id="load-Wu-psf" value="0" step="1" style="width:50px">
                        <span id="load-Wu-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                    <div class="input-row" id="load-L-row" style="display:none">
                        <label>L<span class="hint-inline">psf</span></label>
                        <input type="number" id="load-L-psf" value="0" step="1" style="width:50px">
                        <span id="load-L-plf" class="hint-inline" style="min-width:50px">→0 PLF</span>
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="false"><span class="collapse-icon">▸</span> Deck & Bracing</h3>
                <div style="display:none">
                    <div class="input-row">
                        <label>Deck</label>
                        <select id="select-deck-type" style="width:140px">
                            <option value="through-fastened">Through-fastened</option>
                            <option value="standing-seam">Standing Seam</option>
                            <option value="none">None</option>
                        </select>
                    </div>
                    <div class="input-row" id="deck-detail-row">
                        <label>t<span class="hint-inline">in</span></label>
                        <input type="number" id="deck-t-panel" value="0.018" step="0.001" style="width:55px">
                        <label>@<span class="hint-inline">in</span></label>
                        <input type="number" id="deck-fastener-spacing" value="12" step="1" style="width:40px">
                    </div>
                    <div class="input-row" id="deck-kphi-row">
                        <label>kφ override<span class="hint-inline">k-in/rad/in</span></label>
                        <input type="number" id="deck-kphi-override" value="" step="0.001" style="width:70px" placeholder="auto">
                    </div>
                </div>

                <button id="btn-analyze-loads" class="btn-secondary" style="margin-top:8px;width:100%">📊 Analyze Loads</button>
                </div>

                <h3 id="design-lengths-title">Unbraced Lengths</h3>
                <div class="input-row" id="design-KxLx-row">
                    <label>KxLx<span class="hint-inline">in</span></label>
                    <input type="number" id="design-KxLx" value="120" step="1" style="width:65px">
                    <label>KyLy</label>
                    <input type="number" id="design-KyLy" value="120" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-KtLt-row">
                    <label>KtLt<span class="hint-inline">in</span></label>
                    <input type="number" id="design-KtLt" value="120" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-Cb-row">
                    <label>Cb</label>
                    <input type="number" id="design-Cb" value="1.0" step="0.01" style="width:65px">
                </div>
                <div class="input-row" id="design-Lb-row">
                    <label>Lb<span class="hint-inline">in (LTB)</span></label>
                    <input type="number" id="design-Lb" value="120" step="1" style="width:65px">
                </div>
                <div class="input-row" id="design-Cm-row" style="display:none">
                    <label>Cmx</label>
                    <input type="number" id="design-Cmx" value="0.85" step="0.01" style="width:55px">
                    <label>Cmy</label>
                    <input type="number" id="design-Cmy" value="0.85" step="0.01" style="width:55px">
                </div>

                <h3>Required Loads</h3>
                <div class="input-row">
                    <label>P<span class="hint-inline">kips</span></label>
                    <input type="number" id="design-P" value="0" step="0.1" style="width:65px">
                    <label>V<span class="hint-inline">kips</span></label>
                    <input type="number" id="design-V" value="0" step="0.1" style="width:65px">
                </div>
                <div class="input-row">
                    <label>Mx<span class="hint-inline">kip-in</span></label>
                    <input type="number" id="design-Mx" value="0" step="0.1" style="width:65px">
                    <label>My<span class="hint-inline">kip-in</span></label>
                    <input type="number" id="design-My" value="0" step="0.1" style="width:65px">
                </div>

                <div id="design-wc-section" style="display:none">
                    <h3>Web Crippling (§G5)</h3>
                    <div class="input-row">
                        <label>N<span class="hint-inline">in</span></label>
                        <input type="number" id="design-wc-N" value="3.5" step="0.1" style="width:55px">
                        <label>R<span class="hint-inline">in</span></label>
                        <input type="number" id="design-wc-R" value="0.1875" step="0.01" style="width:65px">
                    </div>
                    <div class="input-row">
                        <label>Support</label>
                        <select id="design-wc-support" style="width:120px">
                            <option value="EOF">EOF (End 1-flange)</option>
                            <option value="IOF">IOF (Int. 1-flange)</option>
                            <option value="ETF">ETF (End 2-flange)</option>
                            <option value="ITF">ITF (Int. 2-flange)</option>
                        </select>
                    </div>
                </div>

                <button id="btn-run-design" class="btn-primary" style="margin-top:12px;width:100%">▶ Run Design Check</button>
                <p class="hint" style="margin-top:6px">Run Analysis first for automatic DSM buckling values.</p>
            </div>

            <div class="panel-right">
                <div id="load-analysis-section" style="display:none">
                <h3>Load Analysis Results</h3>
                <div id="load-analysis-result" class="result-box" style="max-height:300px;overflow-y:auto;font-size:12px">
                </div>
                </div>

                <h3>Design Summary</h3>
                <div id="design-loading" class="loading-overlay" style="display:none">
                    <div class="loading-spinner"></div><span>Calculating...</span>
                </div>
                <div id="design-summary" class="result-box" style="min-height:80px">
                    <p class="hint">Run design check to see results</p>
                </div>

                <h3>Step-by-Step Calculation</h3>
                <div id="design-steps" class="result-box" style="max-height:450px;overflow-y:auto">
                </div>

                <h3 id="design-interaction-title" style="display:none">Interaction Check (H1.2)</h3>
                <div id="design-interaction" class="result-box" style="display:none">
                </div>

                <h3>Specification Reference</h3>
                <div id="design-reference" class="result-box">
                    <p class="hint">AISI S100-16 applicable sections will appear here</p>
                </div>
                <button id="btn-copy-report" class="btn-secondary" style="margin-top:8px;width:100%;display:none">Copy Report to Clipboard</button>
            </div>
        </div>
    </div>

    <!-- Report 탭 -->
    <div id="tab-report" class="tab-panel">
        <div style="display:flex;gap:8px;margin-bottom:8px">
            <button id="btn-generate-report" class="btn-primary" style="flex:1">Generate Detailed Report</button>
            <button id="btn-print-report" class="btn-secondary" style="width:100px;display:none">Print</button>
        </div>
        <div id="report-container" style="background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;padding:16px;min-height:200px;max-height:calc(100vh - 100px);overflow-y:auto">
            <p class="hint" style="text-align:center;padding:40px 0">Run Design Check first, then click "Generate Detailed Report" to create a comprehensive calculation report.</p>
        </div>
    </div>

    <!-- Validation 탭 -->
    <div id="tab-validation" class="tab-panel">
        <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
            <button id="btn-run-validation" class="btn-primary" style="flex:1">Run Design Validation</button>
            <span id="validation-summary-badge" style="font-size:12px;font-weight:600"></span>
        </div>
        <div id="validation-container" style="max-height:calc(100vh - 100px);overflow-y:auto">
            <p class="hint" style="text-align:center;padding:40px 0">Click "Run Design Validation" to check all inputs and results against AISI S100-16 requirements.</p>
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
