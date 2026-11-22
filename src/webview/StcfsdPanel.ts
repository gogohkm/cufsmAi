/**
 * CUFSM WebView 패널
 *
 * 참조: 컨버전전략.md §5.3 WebView, §11 VS Code 테마 연동
 * stgen dxfEditorProvider.ts 패턴 참조
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as cp from 'child_process';
import * as fs from 'fs';
import { PythonBridge } from '../bridge/PythonBridge';
import { ProjectExplorerProvider } from './ProjectExplorerProvider';
import { McpPanelInterface } from '../mcp/bridge';
import { StcfsdModel, WebviewToExtMessage, createDefaultModel } from '../models/types';
import { defaultSteel, mpaField, steelGradeOptionsHtml } from './steelGrades';

function isTestMode(): boolean {
    return process.env.STCFSD_TEST_MODE === '1';
}

export class StcfsdPanel implements McpPanelInterface {
    public static readonly viewType = 'stcfsd.designer';
    /** .csd 에 저장하는 결과의 형식 판(묶음 2 의 세 상태 판정 · 구간별 퍼린). 결과 키의 뜻이 바뀌면 올린다. */
    public static readonly RESULTS_FORMAT = 2;
    public static currentPanel: StcfsdPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _pythonBridge: PythonBridge;
    private readonly _treeProvider?: ProjectExplorerProvider;
    private _disposed = false;
    private _currentSection = 'preprocessor';

    private _model: StcfsdModel;
    private _lastAnalysisResult: any = null;
    private _lastLoadAnalysis: any = null;
    private _lastDesignResult: any = null;
    private _lastDesignRequest: any = null;
    private _preparedDesignDsm: any = null;
    private _preparedDesignDsmSig = '';
    private _derivedInputRevision = 0;
    private _lastPreviewPath: string = '';
    private _previewTargetPath: string = '';
    private _previewSeq = 0;
    private _previewResolve: ((value: any) => void) | null = null;
    private _testPostedMessages: Array<{ command: string; data: any }> = [];
    private _bucklingReportPanel?: vscode.WebviewPanel;
    private _bucklingReportHtml = '';

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

    public async __testDispatchMessage(message: WebviewToExtMessage): Promise<void> {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        await this._handleMessage(message);
    }

    public __testGetPostedMessages(): Array<{ command: string; data: any }> {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        return JSON.parse(JSON.stringify(this._testPostedMessages));
    }

    public __testClearPostedMessages(): void {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        this._testPostedMessages = [];
    }

    public __testGetState(): any {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        return JSON.parse(JSON.stringify({
            currentSection: this._currentSection,
            model: {
                nodeCount: this._model.node?.length || 0,
                elemCount: this._model.elem?.length || 0,
                loadCase: (this._model as any).loadCase || null,
                loadFy: (this._model as any).loadFy || null,
                BC: this._model.BC,
                m_all: this._model.m_all,
                nlengths: this._model.lengths?.length || 0,
                sectionType: (this._model as any).sectionType || null,
                GBTcon: (this._model as any).GBTcon || null,
                signature: this._currentModelSignature(),
            },
            lastAnalysis: this._lastAnalysisResult ? {
                lengths: this._lastAnalysisResult.lengths ?? null,
                m_all: this._lastAnalysisResult.m_all ?? null,
                m_all_selection: this._lastAnalysisResult.m_all_selection ?? null,
                warnings: this._lastAnalysisResult.analysis_warnings ?? [],
                classification_status: this._lastAnalysisResult.classification_status ?? null,
            } : null,
            lastAnalysisMeta: this._lastAnalysisResult?._meta || null,
            preparedDesignDsm: this._preparedDesignDsm || null,
            preparedDesignDsmSig: this._preparedDesignDsmSig || '',
            lastDesignResult: this._lastDesignResult || null,
        }));
    }

    public __testGetHtml(): string {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        return this._panel.webview.html;
    }

    /** 초기 기본 단면 생성 후 모델 전송 — UI 기본값과 일치시킴 */
    private async _initializeWithDefaultSection(): Promise<void> {
        try {
            // UI 기본값: H=100mm(3.937in), B=50mm(1.969in), D=20mm(0.787in),
            //           t=2.3mm(0.0906in), r=4mm(0.157in), 립 90° — 기본 강종(steelGrades.ts, SGC400 Fy 295 MPa).
            // 화면의 기본 하중 case(압축)와 같은 균일 압축 응력으로 둔다 — 모델과 표지가 같아야 한다(R8-03).
            // 화면 재료 칸의 처음 값과 같은 표에서 온다(panel_host_contract 가 대조).
            (this._model as any).loadFy = defaultSteel().Fy;
            await this._applyTemplate('lippedc', { H: 3.937, B: 1.969, D: 0.787, t: 0.0906, r: 0.157, qlip: 90 });
        } catch (err: any) {
            console.error('[StCFSD] Failed to generate default section:', err.message);
        }

        // 기본 길이 설정 — 항은 서버가 BC 에 따라 고른다.
        if (!this._model.lengths || this._model.lengths.length === 0) {
            const lengths: number[] = [];
            for (let i = 0; i < 50; i++) {
                lengths.push(Math.pow(10, 0 + 3 * i / 49));
            }
            this._model.lengths = lengths;
            this._model.m_all = 'auto';
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
                // 단, node/elem은 이미 설정된 this._model 것을 사용
                if (message.data) {
                    if (message.data.prop) this._model.prop = message.data.prop;
                    if (message.data.lengths) this._model.lengths = message.data.lengths;
                    // 화면은 m_all 'auto' 를 보낸다 — 서버가 BC 에 맞는 항을 고른다(F1 후속 1).
                    this._model.m_all = message.data.m_all ?? 'auto';
                    if (message.data.BC) this._model.BC = message.data.BC;
                    // R2-01: GUI도 MCP와 같은 neigs 계약(양의 정수)을 적용한다.
                    if (message.data.neigs !== undefined && message.data.neigs !== null) {
                        if (!Number.isInteger(message.data.neigs) || message.data.neigs <= 0) {
                            this._postMessage('analysisError', {
                                error: `Invalid neigs: ${message.data.neigs} (positive integer required)`,
                            });
                            break;
                        }
                        this._model.neigs = message.data.neigs;
                    }
                    if (message.data.loadCase) (this._model as any).loadCase = message.data.loadCase;
                    // custom 하중 값은 모델에 남겨 화면 칸 동기화(modelLoaded)가 되돌릴 수 있게.
                    if (message.data.stressOpts?.type === 'custom' && message.data.loadCase === 'custom') {
                        const so = message.data.stressOpts;
                        (this._model as any).loadValues = { P: so.P ?? 0, Mxx: so.Mxx ?? 0, Mzz: so.Mzz ?? 0 };
                    }
                    // 응력 설정을 해석 직전에 동기적으로 처리 (레이스 컨디션 방지)
                    if (message.data.stressOpts) {
                        try {
                            await this._applyStressToModel(this._model as any, message.data.stressOpts);
                        } catch (e: any) {
                            this._postMessage('analysisError', { error: e?.message || String(e) });
                            break;
                        }
                        // custom(실하중, fy 없음)은 _applyStressToModel 이 loadFy 를 지운다 — 옛 기준응력을 남기지 않는다.
                    }
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
                this._invalidateAnalysisState('Model updated', true);
                this._updateTreeView();
                break;

            case 'invalidateDerivedResults':
                this._derivedInputRevision++;
                if (message.data?.scope === 'load') {
                    this._lastLoadAnalysis = null;
                }
                this._lastDesignResult = null;
                break;

            case 'saveProject':
                // WebView에서 Design 탭 데이터를 수집하도록 요청
                this._postMessage('collectDesignData', null);
                // 응답은 'designDataCollected' 메시지로 옴
                break;

            case 'designDataCollected':
                try {
                    await this._saveProject(message.data);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Project save failed: ${error.message || error}`);
                }
                break;

            case 'openProject':
                await this._openProject();
                break;

            case 'showBucklingReport':
                this._showBucklingReport(message.data?.html || '');
                break;

            case 'saveReportPdf':
                await this._saveReportPdf(message.data);
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

            case 'runVibration':
                await this._runVibration(message.data);
                break;

            case 'runLapConnection':
                // MCP design_lap_connection 과 같은 handleMcpAction 경로(결과 push 포함).
                try {
                    await this.handleMcpAction({ action: 'lap_connection', ...message.data });
                } catch (e: any) {
                    this._postMessage('lapConnectionResult', { error: e.message });
                }
                break;

            case 'runConnection':
                // MCP design_connection 과 같은 경로. 요청 입력은 도면용으로 결과에 함께 싣는다.
                try {
                    await this.handleMcpAction({ action: 'design_connection', ...message.data });
                } catch (e: any) {
                    this._postMessage('connectionResult', { error: e.message });
                }
                break;

            case 'runPurlinDesign':
                // 자동 계산 모드의 설계 검토 — MCP design_purlin 과 같은 _designPurlin.
                try {
                    await this.handleMcpAction({ action: 'design_purlin', ...message.data });
                } catch (e: any) {
                    this._postMessage('designPurlinResult', { error: e.message || String(e) });
                }
                break;

            case 'runDesign':
                try {
                    await this.handleMcpAction({ action: 'aisi_design', ...message.data });
                } catch (e: any) {
                    this._postMessage('designResult', { error: e.message || String(e) });
                }
                break;

            case 'prepareDesignDsm':
                try {
                    const prepResult = await this.handleMcpAction({ action: 'prepare_design_dsm', ...message.data });
                    this._postMessage('designDsmPrepared', prepResult);
                } catch (e: any) {
                    this._postMessage('designDsmPrepared', { error: e.message || String(e) });
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
                // WebView에서 PNG 캡처 완료 → 이번 요청의 파일로 저장(R8-18)
                {
                    let written: string | undefined;
                    let writeError: string | undefined;
                    if (message.data?.png_base64 && this._previewTargetPath) {
                        try {
                            const base64 = message.data.png_base64.replace(/^data:image\/png;base64,/, '');
                            fs.writeFileSync(this._previewTargetPath, Buffer.from(base64, 'base64'));
                            written = this._previewTargetPath;
                        } catch (e: any) {
                            writeError = `Could not write the preview PNG: ${e?.message || e}`;
                        }
                    }
                    if (this._previewResolve) {
                        const payload = writeError
                            ? { error: writeError }
                            : { ...(message.data || {}), __written_path: written };
                        this._previewResolve(payload);
                        this._previewResolve = null;
                    }
                }
                break;

        }
    }

    /** 좌굴 해석 실행 (GUI) — MCP run_analysis 와 같은 _performAnalysis 를 쓴다. */
    private async _runAnalysis(_model: StcfsdModel): Promise<void> {
        void _model;
        try {
            await this._performAnalysis();
        } catch (err: any) {
            this._postMessage('analysisError', { error: err.message });
            vscode.window.showErrorMessage(`CUFSM Analysis Error: ${err.message}`);
        }
    }

    /**
     * 현재 모델의 FSM 해석 → cFSM 분류 → 현재 응력 family 의 DSM. GUI 와 MCP 의 한 길.
     * 하나의 곡선을 P 와 M 에 동시에 환산하지 않는다(다른 응력상태의 곡선이 된다).
     */
    private async _performAnalysis(): Promise<{ result: any; dsm: any; dsmError?: string; warnings: string[] }> {
        this._postMessage('analysisStarted', null);
        this._invalidateAnalysisState('New analysis started');
        const snapshot = this._cloneModel(this._model);
        const signature = this._modelSignature(snapshot);
        const loadType = (snapshot as any).loadCase || 'unknown';
        const analysisFy = this._getAnalysisFy(snapshot);
        const result = await this._analyzeModel(snapshot, 'FSM analysis');

        // cFSM 모드 분류를 먼저 수행하여 DSM 최소점의 L/D 식별에 직접 사용한다.
        const classDetail = await this._classifyAnalysis(snapshot, result);
        this._requireCurrentSignature(signature, 'FSM analysis');
        this._setAnalysisResult(result, loadType, signature, analysisFy, { BC: snapshot.BC, kind: 'analysis' });
        const warnings = this._analysisWarnings(result);
        this._lastAnalysisResult.analysis_warnings = warnings;
        this._attachClassification(classDetail);
        this._postMessage('analysisComplete', this._lastAnalysisResult);

        let dsm: any = null;
        let dsmError: string | undefined;
        try {
            dsm = await this._extractCurrentAnalysisDsm();
            this._requireCurrentSignature(signature, 'DSM extraction');
            this._postMessage('dsmResult', { P: dsm.P, Mxx: dsm.Mxx, Mzz: dsm.Mzz,
                load_family: dsm.load_family, warning: dsm.warning });
        } catch (dsmErr: any) {
            dsmError = dsmErr?.message || String(dsmErr);
            console.error('[StCFSD] DSM extraction failed:', dsmError);
            this._postMessage('dsmResult', { P: null, Mxx: null, Mzz: null,
                load_family: this._analysisFamily(loadType), error: `DSM extraction failed: ${dsmError}` });
        }

        if (this._treeProvider) {
            this._treeProvider.updateProjectData({
                name: 'Current Section',
                nnodes: snapshot.node?.length || 0,
                nelems: snapshot.elem?.length || 0,
                BC: snapshot.BC || '',
                nlengths: snapshot.lengths?.length || 0,
                hasResults: true,
            });
        }
        return { result, dsm, dsmError, warnings };
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
        const mat = prop.length > 0 ? prop[0] : [100, 29500, 29500, 0.3, 0.3, 11300];

        return {
            nnodes: node.length,
            nelems: elem.length,
            BC: this._model.BC || 'S-S',
            nlengths: lengths.length,
            hasModel: node.length > 0,
            hasAnalysis: this._isAnalysisCurrent(),
            analysisStale: !!this._lastAnalysisResult && !this._isAnalysisCurrent(),
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

    /**
     * 해석 기준응력(곡선의 LF 가 곱해지는 응력): loadFy → 절점 최대 |응력|.
     * 응력이 없으면 0 — 강종 기본값을 지어내지 않는다. DSM 추출이 0 을 거절한다.
     */
    private _getAnalysisFy(model: StcfsdModel = this._model): number {
        const fy = Number((model as any).loadFy);
        if (Number.isFinite(fy) && fy > 0) { return fy; }
        return Math.max(...(model.node || []).map((n: number[]) => Math.abs(n[7] || 0)), 0);
    }

    private _modelSignature(model: StcfsdModel): string {
        const value = (key: string, fallback: any) => (model as any)[key] ?? fallback;
        return JSON.stringify({
            prop: model.prop || [],
            node: model.node || [],
            elem: model.elem || [],
            lengths: model.lengths || [],
            springs: value('springs', []),
            constraints: value('constraints', []),
            BC: model.BC || 'S-S',
            m_all: model.m_all || [],
            GBTcon: value('GBTcon', {}),
            neigs: Number(value('neigs', 10)),
            loadCase: value('loadCase', 'unknown'),
            loadFy: Number(value('loadFy', this._getAnalysisFy(model))),
        });
    }

    private _currentModelSignature(): string {
        return this._modelSignature(this._model);
    }

    private _currentDesignDsmSignature(fy?: number): string {
        const snapshot = this._cloneModel(this._model as any);
        // 설계 DSM 캐시는 새 응력분포를 생성하므로 현재 응력값/하중명은 제외한다.
        snapshot.node = (snapshot.node || []).map((n: number[]) => {
            const copy = [...n];
            copy[7] = 0;
            return copy;
        });
        snapshot.loadCase = 'design-preparation';
        snapshot.loadFy = Number(fy ?? this._getAnalysisFy());
        return this._modelSignature(snapshot);
    }

    private _cloneModel<T>(model: T): T {
        return JSON.parse(JSON.stringify(model));
    }

    private async _applyStressToModel(model: any, options: any): Promise<any> {
        // 순수 분포의 기준응력: 준 fy → 모델의 기준응력. 강종 기본값을 지어내지 않는다.
        const fy = options.fy || model.loadFy;
        if ((options.type === 'uniform_compression' || options.type === 'pure_bending') && !(fy > 0)) {
            throw new Error(`Stress type '${options.type}' needs a reference stress fy (ksi).`);
        }
        if (options.type === 'uniform_compression') {
            for (const n of model.node) { n[7] = fy; }
        } else if (options.type === 'pure_bending') {
            const result = await this._pythonBridge.call('stresgen', {
                node: model.node,
                props: await this._pythonBridge.call('get_properties', {
                    node: model.node, elem: model.elem
                }),
                loads: { P: 0, Mxx: 1, Mzz: 0, M11: 0, M22: 0 },
            });
            if (result?.node) {
                let maxStress = 0;
                for (const n of result.node) {
                    maxStress = Math.max(maxStress, Math.abs(n[7]));
                }
                if (maxStress > 0) {
                    const scale = fy / maxStress;
                    for (const n of result.node) { n[7] *= scale; }
                }
                model.node = result.node;
            }
        } else if (options.type === 'custom') {
            const result = await this._pythonBridge.call('stresgen', {
                node: model.node,
                props: await this._pythonBridge.call('get_properties', {
                    node: model.node, elem: model.elem
                }),
                loads: { P: options.P || 0, Mxx: options.Mxx || 0, Mzz: options.Mzz || 0, M11: 0, M22: 0 },
            });
            if (result?.node) {
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
                model.node = result.node;
            }
        }
        if (options.type === 'custom' && !options.fy) {
            // 실하중 응력: 기준응력은 그 분포의 최대 |응력|(_getAnalysisFy) — loadFy 로 남기지 않는다.
            delete model.loadFy;
        } else {
            model.loadFy = fy;
        }
        return { success: true };
    }

    /**
     * 템플릿 단면 생성 — GUI(generateTemplate)와 MCP(set_section_template)의 한 길.
     * R8-03: 템플릿은 균일 압축 응력을 넣으므로 하중 표지도 'compression' 으로 맞춘다
     * (전: 이전 표지 — 초기값 bending_xx_pos — 가 남아 압축 곡선을 Mxx 로 추출).
     * 엔진의 validation · warnings 를 그대로 돌려준다(W1 후속 9).
     */
    private async _applyTemplate(sectionType: string, params: any): Promise<any> {
        const result = await this._pythonBridge.call('generate_section', {
            section_type: sectionType,
            params,
        });
        if (!result?.node) {
            return { error: 'generate_section returned no nodes', ...(result || {}) };
        }
        const warnings: string[] = Array.isArray(result.warnings) ? [...result.warnings] : [];
        const prevMaxStress = Math.max(0, ...(this._model.node || []).map((n: number[]) => Math.abs(Number(n?.[7]) || 0)));
        this._model.node = result.node;
        this._model.elem = result.elem;
        (this._model as any).sectionTemplate = sectionType;
        (this._model as any).sectionType = this._normalizeSectionType(sectionType);
        (this._model as any).sectionParams = { ...(params || {}) };
        (this._model as any).cornerRadius = params?.r ?? 0;
        // 기준응력: 지금 모델의 것(loadFy) → 이전 응력의 최대 |응력|(custom 실하중 뒤). 둘 다 없으면 강종을
        // 짐작하지 않는다(전: 기본 강종 35.53 ksi 를 넣었다 — Py · My 가 그 강재로 나왔다) — 응력 0 으로 두고
        // set_load_case 의 fy 를 요구한다(_analyzeModel 이 응력 없는 해석을 거절한다).
        let fy = Number((this._model as any).loadFy);
        if (!(fy > 0)) { fy = prevMaxStress; }
        for (const n of this._model.node) { n[7] = fy > 0 ? fy : 0; }
        if (fy > 0) {
            (this._model as any).loadFy = fy;
        } else {
            delete (this._model as any).loadFy;
            warnings.push('Reference stress for the template stress distribution is not set (no previous stress) — '
                + 'call set_load_case with fy before run_analysis; no steel grade is assumed.');
        }
        (this._model as any).loadCase = 'compression';
        this._invalidateAnalysisState('Section template changed', true);
        return {
            success: true,
            nnodes: result.node.length,
            nelems: result.elem?.length,
            section_type: (this._model as any).sectionType,
            load_case: 'compression',
            fy_reference: fy > 0 ? fy : null,
            ...(result.validation !== undefined ? { validation: result.validation } : {}),
            warnings,
        };
    }

    /**
     * F14: custom 하중을 응력 생성에 전달한다.
     * 계약: 생략된 힘은 0으로 간주한다. custom loadCase는 해석 _meta의
     * load_type에 그대로 기록되어 P/Mxx 해석 family와 구분된다.
     */
    private async _setLoadCaseOnModel(model: any, loadCase: string, fy: number,
        loads?: { P?: number; Mxx?: number; Mzz?: number }): Promise<void> {
        let stressOpts: any;
        if (loadCase === 'compression') {
            stressOpts = { type: 'uniform_compression', fy };
        } else if (loadCase === 'bending_xx' || loadCase === 'bending_xx_pos') {
            stressOpts = { type: 'pure_bending', fy };
        } else if (loadCase === 'bending_xx_neg') {
            stressOpts = { type: 'custom', P: 0, Mxx: -1, Mzz: 0, fy };
        } else if (loadCase === 'bending_zz' || loadCase === 'bending_zz_pos') {
            stressOpts = { type: 'custom', P: 0, Mxx: 0, Mzz: 1, fy };
        } else if (loadCase === 'bending_zz_neg') {
            stressOpts = { type: 'custom', P: 0, Mxx: 0, Mzz: -1, fy };
        } else {
            stressOpts = {
                type: 'custom',
                P: loads?.P ?? 0, Mxx: loads?.Mxx ?? 0, Mzz: loads?.Mzz ?? 0, fy,
            };
        }
        await this._applyStressToModel(model, stressOpts);
        model.loadCase = loadCase;
    }

    private _setAnalysisResult(result: any, loadType: string, signature: string,
                               analysisFy: number, extra?: { BC?: string; kind?: string }): void {
        this._lastAnalysisResult = {
            ...result,
            _meta: {
                load_type: loadType,
                load_family: this._analysisFamily(loadType),
                fy: analysisFy,
                // 곡선이 실제로 푼 경계조건(서명곡선은 모델 BC 와 무관하게 S-S).
                BC: extra?.BC ?? this._model.BC,
                kind: extra?.kind ?? 'analysis',
                signature,
                timestamp: new Date().toISOString(),
            },
        };
    }

    /**
     * 서버에 보낼 해석 모델. 길이마다 항이 정해진 목록이 아니면 'auto' — 서버가 BC 에 따라
     * S-S → [1], 그 밖 → m_recommend 권장 항을 쓴다(F1 후속 1 · W1). BC 를 채우지 않는다.
     */
    private _analysisParams(model: any): any {
        const m = this._cloneModel(model);
        const lengths = Array.isArray(m.lengths) ? m.lengths : [];
        const explicit = Array.isArray(m.m_all) && lengths.length > 0 && m.m_all.length === lengths.length
            && m.m_all.every((t: any) => Array.isArray(t) && t.length > 0);
        m.m_all = explicit ? m.m_all : 'auto';
        delete m.stressOpts;
        return m;
    }

    /** FSM 해석 한 번(analyze). 실패하면 엔진 진단 문장으로 예외. */
    private async _analyzeModel(model: any, context: string): Promise<any> {
        // 응력 분포가 없으면(모든 절점 응력 0) 좌굴해석을 하지 않는다 — 기준응력을 지어내지 않는다.
        if (!(model?.node || []).some((n: number[]) => Math.abs(Number(n?.[7]) || 0) > 0)) {
            throw new Error(`${context}: the model has no stress distribution (all node stresses are 0) — `
                + 'set the load case with a reference stress fy (set_load_case) or node stresses first.');
        }
        const result = await this._pythonBridge.analyze(this._analysisParams(model));
        this._requireSuccessfulAnalysis(result, context);
        return result;
    }

    /** 해석 결과의 길이(폐기 길이 제외) — 곡선·shapes·m_all 이 같은 순서로 이 길이를 담는다. */
    private _resultLengths(result: any, model?: any): number[] {
        if (Array.isArray(result?.lengths) && result.lengths.length > 0) { return result.lengths; }
        if (Array.isArray(result?.curve)) { return result.curve.map((row: number[]) => row?.[0]); }
        return model?.lengths || [];
    }

    /**
     * FSM 모드형상을 cFSM G/D/L/O 로 분류한다(classify_detailed). 해석이 실제로 쓴 길이·항을
     * 넘긴다(폐기 길이가 있으면 모델 길이와 다르다). 분류할 수 없는 단면(둥근 모서리 등)은
     * status 'unsupported' 와 null 행으로 온다 — DSM 은 그 극소를 휴리스틱으로 정한다.
     */
    private async _classifyAnalysis(model: any, analysis: any): Promise<any | undefined> {
        if (!Array.isArray(analysis?.shapes) || analysis.shapes.length === 0) {
            return undefined;
        }
        const lengths = this._resultLengths(analysis, model);
        const mAll = Array.isArray(analysis?.m_all) ? analysis.m_all : lengths.map(() => [1]);
        const classModel = { ...this._cloneModel(model), lengths, m_all: mAll };
        delete classModel.stressOpts;
        try {
            return await this._pythonBridge.call('classify_detailed', {
                model: classModel,
                shapes: analysis.shapes,
                lengths,
                m_all: mAll,
                GBTcon: model?.GBTcon,
            });
        } catch (error: any) {
            console.error('[StCFSD] cFSM classification failed:', error?.message || error);
            return {
                classification: null, status: 'failed', supported: false, code: 'CLASSIFY_FAILED',
                message: `cFSM 분류 실패: ${error?.message || error} — DSM 은 곡선 극소를 휴리스틱으로 정합니다.`,
            };
        }
    }

    /** classify_detailed 결과에서 DSM 에 넘길 분류 목록(없으면 undefined). */
    private _classificationList(detail: any): any[] | undefined {
        return Array.isArray(detail?.classification) ? detail.classification : undefined;
    }

    private _classificationStatus(detail: any): any {
        if (!detail) { return null; }
        return {
            status: detail.status, supported: detail.supported,
            code: detail.code, message: detail.message,
        };
    }

    /** 표시 해석 결과에 분류를 붙이고 웹뷰에 보낸다. */
    private _attachClassification(detail: any): void {
        if (!detail || !this._lastAnalysisResult) { return; }
        this._lastAnalysisResult.classifications = this._classificationList(detail);
        this._lastAnalysisResult.classification_status = this._classificationStatus(detail);
        this._postMessage('classifyResult', {
            classification: this._lastAnalysisResult.classifications ?? null,
            ...this._lastAnalysisResult.classification_status,
        });
    }

    private _requireSuccessfulAnalysis(result: any, context: string): void {
        if (result?.success !== false) {
            return;
        }
        // 폐기 길이(discarded: true)는 실패가 아니다 — 남은 실패 진단만 보인다.
        const detail = Array.isArray(result?.diagnostics)
            ? result.diagnostics
                .filter((d: any) => !d?.discarded && (d?.severity === 'error' || d?.severity == null))
                .map((d: any) => d.message || d.code).filter(Boolean).join('; ')
            : '';
        throw new Error(`${context} failed${detail ? `: ${detail}` : ''}`);
    }

    /** 해석 경고(항 부족 · 폐기 길이 · m_recommend) — 성공해도 사용자에게 보인다. */
    private _analysisWarnings(result: any): string[] {
        const out: string[] = [];
        const add = (s: any) => { if (s && !out.includes(String(s))) { out.push(String(s)); } };
        (Array.isArray(result?.warnings) ? result.warnings : []).forEach(add);
        if (Array.isArray(result?.discarded_lengths) && result.discarded_lengths.length > 0) {
            add(`해석에서 버린 길이 ${result.discarded_lengths.length}개(수치 조건 불량): `
                + result.discarded_lengths.map((L: number) => Number(L).toPrecision(4)).join(', ') + ' in');
        }
        return out;
    }

    /**
     * DSM 추출 한 경로. fy 는 언제나 곡선을 만든 해석 기준응력, BC 는 곡선이 푼 경계조건.
     * 유효좌굴길이·Lb 를 줄 때만 section_type 이 필요하다(R8-05) — 모델 형식을 쓰고,
     * 사용자 단면처럼 폐형식이 없는 형식이면 지어내지 않고 오류.
     */
    private async _callDsm(args: {
        node: number[][]; elem: number[][]; curve: number[][]; fy: number;
        load_type: 'P' | 'Mxx' | 'Mzz'; classifications?: any; BC: string;
        KxLx?: number; KyLy?: number; KtLt?: number; Lb?: number; Cb?: number; section_type?: string;
    }): Promise<any> {
        if (!(Number(args.fy) > 0)) {
            throw new Error('DSM extraction needs the analysis reference stress (fy) — the model has no stress distribution.');
        }
        const params: any = {
            node: args.node, elem: args.elem, curve: args.curve, fy: args.fy,
            load_type: args.load_type, BC: args.BC,
        };
        if (Array.isArray(args.classifications)) { params.classifications = args.classifications; }
        const global = ['KxLx', 'KyLy', 'KtLt', 'Lb'].filter((k) => (args as any)[k] !== undefined && (args as any)[k] !== null);
        for (const k of [...global, 'Cb']) {
            if ((args as any)[k] !== undefined && (args as any)[k] !== null) { params[k] = (args as any)[k]; }
        }
        if (global.length > 0) {
            const st = args.section_type ?? this._sectionTypeForEngine(this._model);
            if (!st || st === 'custom') {
                throw new Error('section_type is required for the closed-form global buckling values (KxLx/KyLy/KtLt/Lb) '
                    + 'and the current model has no template section type — pass section_type explicitly (C, Z, ...).');
            }
            params.section_type = st;
        } else if (args.section_type) {
            params.section_type = args.section_type;
        }
        return await this._pythonBridge.call('dsm', params);
    }

    /**
     * 설계 엔진에 넘길 dsm 사전. 탄성 임계값(Pcrl·Pcrd·Mcrl·Mcrd)과 F5 진단 키만 옮기고
     * Py·My 는 보내지 않는다 — 엔진이 설계 Fy 로 Ag·Fy, Sf·Fy 를 만든다(R8-02, F4 R4-03).
     * 못 찾은 값(null·0·NaN)은 보내지 않는다 — 엔진이 해석식 대체 또는 「평가하지 못함」.
     */
    private _dsmForDesign(P: any, M: any, fyAnalysis?: number, mSign?: '+' | '-'): any {
        const pos = (v: any) => (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : undefined;
        const out: any = {};
        // F5 의 진단 키는 전부 P_/M_ 접두로 옮긴다(엔진이 읽는 이름 — 하한 crl_floor/crd_floor, single_minimum,
        // boundary_minimum, reference_stress_consistent, reference_unsymm, reference_is_restrained …).
        // 그 판단을 TypeScript 에서 다시 하지 않는다. 항복값(P_y/P_ref)과 곡선 배열은 옮기지 않는다.
        const skip = new Set(['crl', 'crd', 'cre', 'P_y', 'Py', 'P_ref', 'P_ref_restrained', 'curve', 'minima', 'LF_curve']);
        const copy = (src: any, prefix: string) => {
            if (!src || typeof src !== 'object') { return; }
            for (const [k, v] of Object.entries(src)) {
                if (skip.has(k) || v === undefined || v === null) { continue; }
                if (Array.isArray(v) && k !== 'warnings' && k !== 'assumptions' && k !== 'scope_notes') { continue; }
                if (typeof v === 'object' && !Array.isArray(v)) { continue; }
                out[prefix + k] = v;
            }
        };
        if (P) {
            if (pos(P.crl) !== undefined) { out.Pcrl = P.crl; }
            if (pos(P.crd) !== undefined) { out.Pcrd = P.crd; }
            copy(P, 'P_');
        }
        if (M) {
            if (pos(M.crl) !== undefined) { out.Mcrl = M.crl; }
            if (pos(M.crd) !== undefined) { out.Mcrd = M.crd; }
            if (pos(M.Lcrd) !== undefined) { out.Lcrd = M.Lcrd; }
            copy(M, 'M_');
        }
        if (pos(fyAnalysis) !== undefined) { out.fy_analysis = fyAnalysis; }
        // V2-06: 휨 좌굴값을 구한 모멘트 부호(x 축 대칭이 아닌 단면에서 엔진이 검토 부호와 맞춘다).
        if (M && mSign) { out.M_sign = mSign; }
        return out;
    }

    /**
     * 설계용 DSM: 단면을 설계 하중 family 의 응력으로 두고 S-S 서명곡선(m = 1)을 푼 뒤 추출한다.
     * 엔진의 자동 경로(aisi_s100._auto_generate_props)와 같은 규약 — GUI · MCP · 퍼린이 같은 값을 쓴다.
     * 표시 해석 결과와 모델은 바꾸지 않는다. springs 를 주면 그 스프링으로(퍼린 정모멘트 데크 구속).
     */
    private async _signatureDsm(baseModel: any, loadCase: string, fy: number, family: 'P' | 'Mxx',
        opts?: { springs?: number[][] }): Promise<{ dsm: any; analysis: any; classification_status: any; warnings: string[];
            classificationNote?: string }> {
        const temp = this._cloneModel(baseModel);
        await this._setLoadCaseOnModel(temp, loadCase, fy);
        temp.BC = 'S-S';
        temp.m_all = 'auto';
        if (opts?.springs) { temp.springs = opts.springs; }
        const analysis = await this._analyzeModel(temp, `${loadCase} DSM preparation analysis`);
        const cls = await this._classifyAnalysis(temp, analysis);
        const dsm = await this._callDsm({
            node: temp.node, elem: temp.elem, curve: analysis.curve, fy,
            load_type: family, classifications: this._classificationList(cls), BC: 'S-S',
        });
        const warnings = this._analysisWarnings(analysis).map((w) => `[${loadCase}] ${w}`);
        // 분류할 수 없는 모델(둥근 모서리 등)은 값 · 판정을 바꾸지 않는다(dsm 이 반파장 순서로 정함) — 경고가 아니라
        // 가정 한 줄. 전체 문장은 분류 그림 옆(classify-status)에만(FIXES §3.1.1, 조정자 지시).
        const classificationNote = cls?.status && cls.status !== 'ok'
            ? `모드 분류: cFSM 을 쓸 수 없는 모델(${cls.code === 'ROUNDED_CORNER' ? '둥근 모서리' : (cls.code || cls.status)}) — 반파장 순서로 정함`
            : undefined;
        return { dsm, analysis, classification_status: this._classificationStatus(cls), warnings, classificationNote };
    }

    private _invalidateAnalysisState(reason: string, invalidateLoads: boolean = false): void {
        this._lastAnalysisResult = null;
        this._preparedDesignDsm = null;
        this._preparedDesignDsmSig = '';
        if (invalidateLoads) {
            this._lastLoadAnalysis = null;
        }
        this._lastDesignResult = null;
        this._lastDesignRequest = null;
        this._postMessage('analysisInvalidated', { reason, invalidateLoads });
        this._updateTreeView();
    }

    /** Compare report inputs with the design result currently cached. */
    private _designCacheMatches(request: any): boolean {
        const cached = this._lastDesignRequest;
        if (!this._lastDesignResult || !cached) { return false; }
        if (request.member_type == null || cached.member_type == null) { return false; }
        if (request.member_type !== cached.member_type) { return false; }
        const skip = new Set(['action', 'loads', 'member_app', 'span_type', 'span_ft', 'spacing_ft']);
        for (const key of Object.keys(request)) {
            if (skip.has(key)) { continue; }
            const value = request[key];
            if (value === undefined) { continue; }
            if (JSON.stringify(value) !== JSON.stringify(cached[key])) { return false; }
        }
        return true;
    }

    private _requireCurrentSignature(signature: string, context: string): void {
        if (signature !== this._currentModelSignature()) {
            throw new Error(`${context} result discarded because the model changed while it was running.`);
        }
    }

    private _requireDerivedRevision(revision: number, context: string): void {
        if (revision !== this._derivedInputRevision) {
            throw new Error(`${context} result discarded because its inputs changed while it was running.`);
        }
    }

    private async _extractCurrentAnalysisDsm(): Promise<any> {
        if (!this._isAnalysisCurrent()) {
            return { P: null, Mxx: null, Mzz: null, load_family: 'unknown', warning: 'No current analysis result.' };
        }
        const analysis = this._lastAnalysisResult;
        const family = this._analysisFamily(analysis?._meta?.load_type);
        const fy = analysis?._meta?.fy || this._getAnalysisFy();
        const common = {
            node: this._model.node,
            elem: this._model.elem,
            curve: analysis.curve,
            fy,
            classifications: analysis.classifications,
            BC: analysis?._meta?.BC || this._model.BC,
        };
        const P = family === 'P'
            ? await this._callDsm({ ...common, load_type: 'P' })
            : null;
        const Mxx = family === 'Mxx'
            ? await this._callDsm({ ...common, load_type: 'Mxx' })
            : null;
        const Mzz = family === 'Mzz'
            ? await this._callDsm({ ...common, load_type: 'Mzz' })
            : null;
        return {
            P,
            Mxx,
            Mzz,
            fy_used: fy,
            load_family: family,
            warning: family === 'P' || family === 'Mxx' || family === 'Mzz'
                ? undefined
                : 'Current stress state is not a pure compression or pure bending case.',
        };
    }

    private _isAnalysisCurrent(loadType?: string): boolean {
        const meta = this._lastAnalysisResult?._meta;
        if (!meta) { return false; }
        if (meta.signature !== this._currentModelSignature()) { return false; }
        if (loadType && meta.load_type && meta.load_type !== loadType) { return false; }
        return Array.isArray(this._lastAnalysisResult.curve) && this._lastAnalysisResult.curve.length > 0;
    }

    /**
     * F06: 데크 스프링 생성 — solver 10열 계약 단일 생성점.
     * 행: [spring#, nodei, nodej, ku, kv, kw, kq, orient, discrete, ys].
     * kx(횡)→ku, kφ(회전)→kq, 접지(nodej=0)·분포(discrete=0).
     * 플랜지 절점 전체에 전체 강성을 균등 분배한다.
     */
    private _deckSpringsForFlange(model: any, kphi: number, kx: number,
        flange: 'top' | 'bottom'): number[][] {
        if (!(kphi > 0) && !(kx > 0)) { return []; }
        const nodes: number[][] = model?.node || [];
        if (nodes.length === 0) { return []; }
        const zs = nodes.map((n: number[]) => n[2]);
        const target = flange === 'top' ? Math.max(...zs) : Math.min(...zs);
        const tol = Math.max(1e-9, (Math.max(...zs) - Math.min(...zs)) * 1e-9);
        const flangeNodes = nodes.filter((n: number[]) => Math.abs(n[2] - target) <= tol);
        if (flangeNodes.length === 0) { return []; }
        const ku = (kx > 0 ? kx : 0) / flangeNodes.length;
        const kq = (kphi > 0 ? kphi : 0) / flangeNodes.length;
        return flangeNodes.map((n: number[], i: number) =>
            [i + 1, n[0], 0, ku, 0, 0, kq, 0, 0, 0]);
    }

    /**
     * F13: 공통 모델 validator. 모든 검증을 적용 전에 수행해 실패 시
     * node/elem snapshot을 그대로 보존한다 (원자적 적용).
     * 규약: node행 [id,x,z,dofx,dofz,dofy,dofrot,stress], elem행 [id,nodei,nodej,t,mat].
     */
    private _requireNodeId(nid: any): number {
        const n = this._model.node?.length || 0;
        if (!Number.isInteger(nid) || nid < 1 || nid > n) {
            throw new Error(`Invalid node_id: ${nid} (integer 1..${n} required)`);
        }
        return nid;
    }

    private _requireElemId(eid: any): number {
        const n = this._model.elem?.length || 0;
        if (!Number.isInteger(eid) || eid < 1 || eid > n) {
            throw new Error(`Invalid elem_id: ${eid} (integer 1..${n} required)`);
        }
        return eid;
    }

    private _requireFinite(value: any, name: string): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error(`Invalid ${name}: ${value} (finite number required)`);
        }
        return value;
    }

    /**
     * R2-02/R2-03: 요소 길이 허용오차. 모델 범위(bbox 대각선)에 비례하며
     * 최소 1e-9 (단위계 무관). 이하는 solver 특이이므로 0길이로 취급한다.
     */
    private _zeroLengthTol(nodes?: number[][]): number {
        const ns = nodes || this._model.node || [];
        if (ns.length < 2) { return 1e-9; }
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const n of ns) {
            if (n[1] < minX) { minX = n[1]; }
            if (n[1] > maxX) { maxX = n[1]; }
            if (n[2] < minZ) { minZ = n[2]; }
            if (n[2] > maxZ) { maxZ = n[2]; }
        }
        const extent = Math.hypot(maxX - minX, maxZ - minZ);
        return 1e-9 * Math.max(1, extent);
    }

    private _requirePositiveLength(ax: number, az: number, bx: number, bz: number,
        what: string, tol: number): void {
        if (Math.hypot(bx - ax, bz - az) <= tol) {
            throw new Error(`Invalid ${what}: zero length (tolerance ${tol.toExponential(1)})`);
        }
    }

    private _requireElementEnds(nodei: any, nodej: any, nodes?: number[][]): void {
        const ns = nodes || this._model.node || [];
        const n = ns.length;
        if (!Number.isInteger(nodei) || nodei < 1 || nodei > n
            || !Number.isInteger(nodej) || nodej < 1 || nodej > n) {
            throw new Error(`Invalid element ends: nodei=${nodei}, nodej=${nodej} (integers 1..${n} required)`);
        }
        if (nodei === nodej) {
            throw new Error(`Invalid element ends: nodei == nodej == ${nodei} (self-connection rejected)`);
        }
        const a = ns[nodei - 1], b = ns[nodej - 1];
        this._requirePositiveLength(a[1], a[2], b[1], b[2],
            `element ends ${nodei}-${nodej}`, this._zeroLengthTol(ns));
    }

    private _requireThickness(t: any): number {
        const v = this._requireFinite(t, 'thickness');
        if (!(v > 0)) {
            throw new Error(`Invalid thickness: ${t} (must be > 0)`);
        }
        return v;
    }

    /** R2-02: 절점 행 배열 검증 (ID·열·유한·DOF 계약). */
    private _validateNodeRows(nodes: number[][]): void {
        if (!Array.isArray(nodes)) {
            throw new Error('Invalid nodes: array required');
        }
        nodes.forEach((row: number[], i: number) => {
            if (!Array.isArray(row) || row.length !== 8) {
                throw new Error(`Invalid node row ${i + 1}: 8 columns required`);
            }
            if (row[0] !== i + 1) {
                throw new Error(`Invalid node row ${i + 1}: id must equal position (${row[0]})`);
            }
            this._requireFinite(row[1], `node[${i + 1}].x`);
            this._requireFinite(row[2], `node[${i + 1}].z`);
            for (let k = 3; k <= 6; k++) {
                if (row[k] !== 0 && row[k] !== 1) {
                    throw new Error(`Invalid node[${i + 1}] dof[${k}]: ${row[k]} (0 or 1 required)`);
                }
            }
            this._requireFinite(row[7], `node[${i + 1}].stress`);
        });
    }

    /** R2-02: 요소 행 배열 검증 — 주어진 절점 집합 기준 참조·두께·길이 교차 검증. */
    private _validateElemRows(elements: number[][], nodes: number[][]): void {
        if (!Array.isArray(elements)) {
            throw new Error('Invalid elements: array required');
        }
        elements.forEach((row: number[], i: number) => {
            if (!Array.isArray(row) || row.length !== 5) {
                throw new Error(`Invalid element row ${i + 1}: 5 columns required`);
            }
            if (row[0] !== i + 1) {
                throw new Error(`Invalid element row ${i + 1}: id must equal position (${row[0]})`);
            }
            this._requireElementEnds(row[1], row[2], nodes);
            this._requireThickness(row[3]);
            this._requireFinite(row[4], `element[${i + 1}].matnum`);
        });
    }

    /**
     * R2-05: 해석 하중 family. DSM은 이 family와 일치하는 항목만 제공한다.
     * custom(혼합·영분포)은 순수 P/Mxx/Mzz로 변환하지 않는다 → null.
     */
    private _loadFamily(loadCase: string): 'P' | 'Mxx' | 'Mzz' | null {
        if (loadCase === 'compression') { return 'P'; }
        if (loadCase === 'bending_xx' || loadCase === 'bending_xx_pos'
            || loadCase === 'bending_xx_neg') { return 'Mxx'; }
        if (loadCase === 'bending_zz' || loadCase === 'bending_zz_pos'
            || loadCase === 'bending_zz_neg') { return 'Mzz'; }
        return null;
    }

    /** R2-05: custom 힘 triple에서 순수성분 loadCase를 추론한다 (set_stress와 동일 규칙). */
    private _inferCustomLoadCase(P: any, Mxx: any, Mzz: any): string {
        if (P && !Mxx && !Mzz) { return 'compression'; }
        if (Mxx && !P && !Mzz) { return Mxx > 0 ? 'bending_xx_pos' : 'bending_xx_neg'; }
        if (Mzz && !P && !Mxx) { return Mzz > 0 ? 'bending_zz_pos' : 'bending_zz_neg'; }
        return 'custom';
    }

    /** F03: 모든 결과 조회가 공유하는 current 검사 오류. */
    private _staleAnalysisError(): any {
        return {
            error: this._lastAnalysisResult
                ? 'Analysis result is stale for the current model. Run analysis again.'
                : 'No analysis result. Run analysis first.',
        };
    }

    private _analysisFamily(loadType?: string): 'P' | 'Mxx' | 'Mzz' | 'custom' | 'unknown' {
        const lc = String(loadType || '').toLowerCase();
        if (lc === 'compression') { return 'P'; }
        // R8-23: 'signature_ss' 는 하중 family 가 아니다(서명곡선도 실제 응력의 family 를 따른다).
        if (lc.startsWith('bending_xx') || lc === 'pure_bending') { return 'Mxx'; }
        if (lc.startsWith('bending_zz')) { return 'Mzz'; }
        if (lc === 'custom') { return 'custom'; }
        return 'unknown';
    }

    private _analysisSupportsDsmLoadType(target: 'P' | 'Mxx'): boolean {
        if (!this._isAnalysisCurrent()) { return false; }
        const family = this._analysisFamily(this._lastAnalysisResult?._meta?.load_type);
        return family === target;
    }

    private _preparedDsmMatchesCurrent(fy: number): boolean {
        return !!this._preparedDesignDsm && this._preparedDesignDsmSig === this._currentDesignDsmSignature(fy);
    }

    /**
     * 템플릿 이름 → 설계 엔진 단면 형식(aisi_s100._CANONICAL_SECTION_NAMES 가 받는 이름).
     * R8-28: rhs · chs · isect 를 'C' 로 만들던 것을 고친다(CHS 는 §F2.3 원형관 분기를 잃었다).
     * 사용자 단면처럼 형식을 모르면 'custom' — 형식별 폐형식 식을 지어내지 않는다.
     */
    private _normalizeSectionType(sectionType?: string): string {
        const st = (sectionType || '').toLowerCase().replace(/[\s-]/g, '');
        const table: Record<string, string> = {
            lippedc: 'C', c: 'C', lippedz: 'Z', z: 'Z', track: 'Track', hat: 'Hat',
            rhs: 'RHS', chs: 'CHS', isect: 'I', i: 'I', tee: 'Tee', angle: 'Angle',
            lipped_angle: 'LippedAngle', lippedangle: 'LippedAngle', sigma: 'Sigma',
        };
        if (table[st]) { return table[st]; }
        if (st === 'custom' || st === 'custom_builder' || st === '') { return 'custom'; }
        return sectionType || 'custom';
    }

    /** 모델의 설계용 단면 형식(정규화). 옛 모델은 sectionType 만 있다. */
    private _sectionTypeForEngine(model: any): string {
        if (model?.sectionTemplate) { return this._normalizeSectionType(model.sectionTemplate); }
        return this._normalizeSectionType(model?.sectionType);
    }

    /**
     * 설계에 넘길 단면 치수(외측 out-to-out)와 평탄폭. 템플릿 규약(engine/template.py)을 따른다:
     * hat 은 H = 상판 폭 · B = 깊이 · D = 브림(립이 아님), CHS 는 바깥지름, 트랙·RHS·앵글·T 는 립 없음.
     * 절점에서 립을 추정하지 않는다(F4 후속, V2-05 · V2-09). 사용자 단면은 판 치수를 모른다고 밝힌다.
     */
    private _designSectionGeometry(model: any): { section: any; flats: any; warnings: string[] } {
        const sp = model?.sectionParams || {};
        const st = this._sectionTypeForEngine(model);
        const elemT = (model?.elem || []).map((e: number[]) => e[3]).filter((v: any) => Number.isFinite(v) && v > 0);
        const uniformT = elemT.length > 0 && elemT.every((v: number) => Math.abs(v - elemT[0]) <= 1e-9 * Math.max(1, elemT[0]))
            ? elemT[0] : undefined;
        const t = Number(sp.t) > 0 ? Number(sp.t) : uniformT;
        const R = Number(sp.r) >= 0 && sp.r !== undefined ? Number(sp.r) : (model?.cornerRadius ?? undefined);
        const warnings: string[] = [];
        const section: any = { type: st };
        const flats: any = {};
        if (t !== undefined) { section.thickness = +Number(t).toFixed(6); flats.t = t; }
        if (R !== undefined) { section.R_corner = R; flats.R = R; }
        const H = Number(sp.H), B = Number(sp.B), D = Number(sp.D);
        const has = (v: number) => Number.isFinite(v) && v > 0;
        switch (st) {
            case 'C': case 'Z': case 'LippedAngle': case 'Sigma':
                if (has(H)) { section.depth = H; }
                if (has(B)) { section.flange_width = B; }
                if (Number.isFinite(D) && D >= 0 && sp.D !== undefined) { section.lip_depth = D; }
                section.qlip = sp.qlip ?? 90;
                break;
            case 'Track': case 'RHS': case 'Angle': case 'Tee': case 'I':
                if (has(H)) { section.depth = H; }
                if (has(B)) { section.flange_width = B; }
                break;
            case 'Hat': {
                // 템플릿 규약: H = 상판 폭, B = 깊이(웹), D = 브림. 엔진의 이름 키(top_width · hat_depth · brim)로
                // 보낸다 — 브림은 립이 아니다(V2-05 · V2-09, F4 후속). lip_depth · depth 는 보내지 않는다.
                const top = has(Number(sp.top_width)) ? Number(sp.top_width) : H;
                const depth = has(Number(sp.depth)) ? Number(sp.depth) : B;
                const brim = sp.brim ?? sp.D;
                if (has(top)) { section.top_width = top; }
                if (has(depth)) { section.hat_depth = depth; }
                if (brim !== undefined && Number.isFinite(Number(brim))) { section.brim = Number(brim); }
                break;
            }
            case 'CHS': {
                const od = has(Number(sp.OD)) ? Number(sp.OD) : (has(H) ? H : D);
                if (has(od)) { section.diameter = od; section.depth = od; }
                break;
            }
            default:
                warnings.push('사용자 단면: 판 치수(웹 깊이·플랜지 폭·립)를 템플릿에서 알 수 없어 보내지 않았습니다 — '
                    + '엔진이 그 치수가 필요한 검토(G2 · G5 · B4 폭두께비)를 「평가하지 못함」으로 보고합니다.');
                break;
        }
        if (t === undefined) {
            warnings.push('요소 두께가 하나가 아니어서 설계 두께 t 를 정하지 않았습니다.');
        }
        return { section, flats, warnings };
    }

    private _estimateWebCount(nodeArr: number[][], elemArr: number[][]): number | undefined {
        if (!nodeArr.length || !elemArr.length) {
            return undefined;
        }
        const zs = nodeArr.map((n: number[]) => n[2]);
        const depth = Math.max(...zs) - Math.min(...zs);
        if (depth <= 0) {
            return undefined;
        }

        let count = 0;
        for (const elem of elemArr) {
            const ni = nodeArr.find((n: number[]) => n[0] === elem[1]);
            const nj = nodeArr.find((n: number[]) => n[0] === elem[2]);
            if (!ni || !nj) {
                continue;
            }
            const dx = Math.abs((nj[1] || 0) - (ni[1] || 0));
            const dz = Math.abs((nj[2] || 0) - (ni[2] || 0));
            if (dz >= 0.35 * depth && dx <= 0.9 * dz) {
                count += 1;
            }
        }
        return count || undefined;
    }

    /**
     * 설계용 단면 성질(grosprop + cutwp). cutwp 가 실패하면 비틀림 성질(J · Cw · 전단중심)을
     * 도심 값 등으로 채우지 않는다(F4 후속: E2.2 미평가 탐지가 막힌다) — 경고를 남기고 빼며,
     * 엔진이 「평가하지 못함」 또는 오류로 답한다. xo · ro 는 보내지 않는다(엔진이 Xs·Zs 로 유도).
     */
    private async _designProps(node: number[][], elem: number[][]): Promise<{ props: any; cutwp: any; warnings: string[] }> {
        const warnings: string[] = [];
        const props = await this._pythonBridge.call('get_properties', { node, elem });
        let cutwp: any = null;
        try {
            cutwp = await this._pythonBridge.call('cutwp', { node, elem });
        } catch (e: any) {
            warnings.push(`cutwp(비틀림 성질 J · Cw · 전단중심) 계산 실패: ${e?.message || e} — `
                + '비틀림·휨비틀림 관련 값을 보내지 않았습니다.');
        }
        const finite = (v: any) => typeof v === 'number' && Number.isFinite(v);
        const merged: any = { ...props };
        delete merged.xo; delete merged.ro;
        if (cutwp) {
            for (const k of ['J', 'Cw', 'Xs', 'Zs', 'B1', 'B2']) {
                if (finite(cutwp[k])) { merged[k] = cutwp[k]; }
            }
            if (Array.isArray(cutwp.nan_substituted) && cutwp.nan_substituted.length > 0) {
                merged.nan_substituted = cutwp.nan_substituted;
                warnings.push(`cutwp 가 계산하지 못한 값: ${cutwp.nan_substituted.join(', ')}`);
            }
        }
        // grosprop 이름 → 설계 엔진 이름. 없는 값은 지어내지 않는다.
        if (finite(props.Sx)) { merged.Sf = props.Sx; merged.Sxx = props.Sx; }
        if (finite(props.Sz)) { merged.Sy = props.Sz; merged.Szz = props.Sz; }
        if (finite(props.rx)) { merged.rx = props.rx; }
        if (finite(props.rz)) { merged.ry = props.rz; }
        return { props: merged, cutwp, warnings };
    }

    /**
     * 부재 설계(압축·휨·조합·인장·접합) 한 길 — GUI runDesign 과 MCP aisi_design_* 가 부른다.
     * DSM 값은 (1) 설계용으로 준비된 값(설계 Fy 로 압축·휨 곡선을 따로 푼 것) → (2) 현재 해석 곡선 중
     * family 가 맞는 것. Py·My 는 보내지 않는다(엔진이 설계 Fy 로 만든다). DSM 진단 키를 함께 넘긴다.
     */
    private async _designMember(options: any): Promise<any> {
        const { action: _action, ...input } = options || {};
        void _action;
        // 접합부는 단면성질/DSM 불필요 → 바로 호출
        if (input.member_type === 'connection') {
            return await this._pythonBridge.call('aisi_design', input);
        }
        if (!this._model.node || this._model.node.length === 0) {
            return {
                error: 'No section defined. Please set up a section in the Preprocessor tab first (e.g., set_section_template), then run Analysis before design.',
                member_type: input.member_type,
            };
        }

        const designModelSignature = this._currentModelSignature();
        const designInputRevision = this._derivedInputRevision;
        const hostWarnings: string[] = [];

        const { props, warnings: propWarnings } = await this._designProps(this._model.node, this._model.elem);
        hostWarnings.push(...propWarnings);

        let dsmValues: any = {};
        let dsmWarning: string | null = null;
        let dsmBasis = 'none';
        const designFy = input.Fy;
        const needs = input.member_type === 'compression' ? ['P']
            : input.member_type === 'flexure' ? ['Mxx']
                : input.member_type === 'combined' ? ['P', 'Mxx'] : [];
        if (needs.length > 0 && designFy !== undefined && this._preparedDsmMatchesCurrent(designFy)) {
            const prepared = this._preparedDesignDsm || {};
            dsmValues = this._dsmForDesign(prepared.P, prepared.Mxx, prepared.fy_analysis, '+');
            dsmBasis = 'prepared';
        } else if (needs.length > 0 && !this._isAnalysisCurrent()) {
            dsmWarning = 'No analysis results. Run FSM analysis first ("해석 실행" auto-prepares design DSM values) to get Mcrl/Mcrd values. Without buckling analysis, DSM cannot reduce capacity below My.';
        } else if (needs.length > 0) {
            try {
                const dsm = await this._extractCurrentAnalysisDsm();
                const lc = String(this._lastAnalysisResult?._meta?.load_type || '');
                dsmValues = this._dsmForDesign(dsm.P, dsm.Mxx, dsm.fy_used, lc.endsWith('_neg') ? '-' : '+');
                dsmBasis = 'current_analysis';
                const missingFamilies: string[] = [];
                if (needs.includes('P') && !dsm.P) { missingFamilies.push('compression'); }
                if (needs.includes('Mxx') && !dsm.Mxx) { missingFamilies.push('strong-axis bending'); }
                if (missingFamilies.length > 0) {
                    dsmWarning = `Current analysis load case does not match ${missingFamilies.join(' / ')} DSM extraction. Run a matching FSM analysis before design ("해석 실행" auto-prepares design DSM values).`;
                }
            } catch (e: any) {
                dsmWarning = `DSM extraction failed: ${e.message || String(e)}`;
                console.error('[StCFSD] DSM extraction error:', e);
            }
        }

        const geom = this._designSectionGeometry(this._model);
        hostWarnings.push(...geom.warnings);
        const sectionInfo: any = { ...geom.section };
        const webCount = this._estimateWebCount(this._model.node, this._model.elem);
        if (webCount != null) { sectionInfo.web_count = webCount; }
        const st = sectionInfo.type;
        if (st === 'Hat') { sectionInfo.family_hint = 'hat'; }
        else if (st === 'I') { sectionInfo.family_hint = 'built_up_i'; }
        else if (st === 'Z') { sectionInfo.family_hint = 'Z'; }
        else if (st === 'C' || st === 'Track') { sectionInfo.family_hint = 'C'; }
        else if ((webCount || 0) >= 3) { sectionInfo.family_hint = 'multi_web'; }

        // §I6.1.2 적용 여부: 스프링(kφ/kx) 존재 시
        const hasDeckSprings = Array.isArray((this._model as any).springs)
            && (this._model as any).springs.length > 0;

        const designParams: any = {
            ...input,
            section_type: input.section_type ?? st,
            props: { ...props, ...geom.flats },
            dsm: { ...dsmValues, ...(input.dsm || {}) },
            section: { ...sectionInfo, ...(input.section || {}) },
            through_fastened: input.through_fastened ?? hasDeckSprings,
        };

        const result = await this._pythonBridge.call('aisi_design', designParams);
        this._requireCurrentSignature(designModelSignature, 'AISI design');
        this._requireDerivedRevision(designInputRevision, 'AISI design');
        if (result && typeof result === 'object') {
            if (dsmWarning) { result.dsm_warning = dsmWarning; }
            result.dsm_basis = dsmBasis;
            if (hostWarnings.length > 0) {
                result.host_warnings = hostWarnings;
                result.warnings = [...(Array.isArray(result.warnings) ? result.warnings : []), ...hostWarnings];
            }
        }
        if (!result?.error) {
            this._lastDesignRequest = JSON.parse(JSON.stringify(input));
            this._lastDesignResult = result;
        }
        return result;
    }

    /**
     * 키워드 엔진 함수의 인자 allowlist — 파이썬 함수의 인자 이름 그대로(W2 의 MCP 스키마와 같은 이름).
     * 여기 없는 키는 오류로 돌려준다(오타가 기본값으로 조용히 바뀌지 않게). 값은 바꾸지 않고 넘긴다.
     */
    private static readonly KW_ALLOWLISTS: Record<string, string[]> = {
        web_crippling: ['h', 't', 'R', 'N', 'Fy', 'theta', 'support', 'fastened', 'section_type',
            'section_family', 'flange_condition', 'Lo', 'edge_distance', 'n_webs', 'web_config',
            'bearing_case', 'support_fastener_spacing', 'd', 'web_holes'],
        calc_deck_stiffness: ['t_panel', 't_purlin', 'fastener_spacing', 'flange_width', 'k_per_fastener',
            'E', 'b_fastener', 'c_fastener', 'Fss_kip', 'D_screw_in', 'Fu1_ksi', 'Fu2_ksi',
            'kphi_override', 'kx_override'],
        check_lap_length: ['d', 'lap_left', 'lap_right'],
        shear_lag: ['Ag', 'An_net', 'x_bar', 'L_conn', 'Fu', 'Fy', 'design_method', 'Usl',
            'connection_case', 'd', 's', 'connection_type', 'b1', 'b2', 'bf', 'bw'],
        block_shear: ['Agv', 'Anv', 'Ant', 'Fy', 'Fu', 'design_method', 'Ubs', 'phi_factor',
            'omega_factor', 'connection_type'],
        cold_work: ['Fyv', 'Fuv', 'R', 't', 'n_corners', 'corner_angle', 'A_corners', 'A_flange',
            'corners_per_flange', 'A_total', 'buckling_precondition'],
        flange_curling: ['bf', 't', 'h', 'f_avg', 'E', 'allowable_cf', 'd', 'wf_is_half_clear_distance'],
        steel_grades: ['include_restricted'],
    };

    /** 전송 키(action · units)를 뺀 업무 인자. MCP 는 SI 를 US 로 바꾼 뒤 보낸다. */
    private _dictParams(options: any): any {
        const { action: _a, units: _u, ...rest } = options || {};
        void _a; void _u;
        return rest;
    }

    /** 키워드 메서드 인자: allowlist 밖의 키는 오류 객체({error})로. */
    private _kwParams(method: string, options: any): any {
        const allow = StcfsdPanel.KW_ALLOWLISTS[method] || [];
        const params: any = {};
        for (const [key, value] of Object.entries(this._dictParams(options))) {
            if (value === undefined) { continue; }
            if (!allow.includes(key)) {
                return { error: `Unsupported parameter '${key}' for ${method} (accepted: ${allow.join(', ')})` };
            }
            params[key] = value;
        }
        return params;
    }

    /**
     * R8-03: 절점 응력을 직접 바꾸면 순수 하중 표지(compression · bending_*)가 더는 맞지 않는다 —
     * 'custom' 으로 두고 기준응력은 분포의 최대 |응력| 으로(loadFy 를 지운다).
     */
    private _markCustomStress(): void {
        (this._model as any).loadCase = 'custom';
        delete (this._model as any).loadFy;
    }

    /**
     * 불러온 모델 검증(R8-28): 절점 · 요소 행, BC, 길이. 하중 표지가 없으면 'custom'(R8-03),
     * m_all 이 길이와 맞지 않으면 'auto'. 실패하면 모델을 바꾸지 않는다.
     */
    private _checkLoadedModel(model: any): { model?: any; error?: string; warnings: string[] } {
        const warnings: string[] = [];
        if (!model || typeof model !== 'object') { return { error: 'no model object', warnings }; }
        try {
            this._validateNodeRows(model.node);
            this._validateElemRows(model.elem, model.node);
        } catch (e: any) {
            return { error: e?.message || String(e), warnings };
        }
        const allowedBC = ['S-S', 'C-C', 'S-C', 'C-S', 'C-F', 'F-C', 'C-G', 'G-C'];
        if (model.BC !== undefined && !allowedBC.includes(model.BC)) {
            return { error: `unknown BC '${model.BC}'`, warnings };
        }
        if (model.lengths !== undefined && (!Array.isArray(model.lengths)
            || model.lengths.some((L: any) => !(typeof L === 'number' && L > 0)))) {
            return { error: 'lengths must be positive numbers', warnings };
        }
        const out = { ...model };
        delete out.format; delete out.version;
        if (!out.loadCase) {
            out.loadCase = 'custom';
            delete out.loadFy;
            warnings.push('The file has no load case label — the stored nodal stresses are treated as a custom distribution.');
        }
        const lengths = Array.isArray(out.lengths) ? out.lengths : [];
        if (!(Array.isArray(out.m_all) && out.m_all.length === lengths.length && lengths.length > 0)) {
            out.m_all = 'auto';
        }
        return { model: out, warnings };
    }

    /** analyze_loads 엔진 인자(파이썬 이름 그대로). 그 밖의 키(Fy, Fu, 설계 옵션 …)는 넘기지 않는다(W1 후속 8). */
    private static readonly ANALYZE_LOADS_ARGS = [
        'member_app', 'span_type', 'span_ft', 'loads', 'design_method', 'spacing_ft', 'laps', 'deck',
        'section', 'supports', 'spans_ft', 'laps_per_support', 'E', 'pattern_loading', 'brace_points_ft',
        'i621_conditions_confirmed', 'insulation_in', 'lr_reduced', 'I_span_in4',
    ];

    /** 구간별 휨 설계 호출에 그대로 얹는 부재 설계 옵션(aisi_design 인자 이름). */
    private static readonly PURLIN_MEMBER_OPTIONS = [
        'use_inelastic_reserve', 'use_cold_work', 'wc_N', 'wc_R', 'wc_fastened', 'wc_web_config',
        'wc_section_family', 'wc_flange_condition', 'wc_overhang', 'wc_edge_distance', 'wc_n_webs',
        'wc_support_fastener_spacing', 'wc_section_type',
    ];

    /**
     * 하중 분석 한 길(GUI analyzeLoads · MCP analyze_loads · design_purlin). 엔진 인자만 골라 보낸다.
     * section 이 없으면 현재 모델의 템플릿 치수와 grosprop Ixx 로 채운다(R8-10 — 지어낸 값이 아니라
     * 지금 단면의 값). 모델에도 없으면 비워 두고 엔진이 R·처짐을 「평가하지 못함」으로 답한다.
     */
    private async _analyzeLoads(options: any): Promise<any> {
        const params: any = {};
        for (const k of StcfsdPanel.ANALYZE_LOADS_ARGS) {
            if (options?.[k] !== undefined) { params[k] = options[k]; }
        }
        if (!params.section && this._model.node?.length) {
            const geom = this._designSectionGeometry(this._model);
            const s: any = { ...geom.section };
            if (s.type === 'Hat') {
                // 하중 분석의 section 은 일반 이름(depth = 웹 깊이, flange_width = 상판 폭)을 쓴다.
                s.depth = s.hat_depth; s.flange_width = s.top_width;
                delete s.hat_depth; delete s.top_width; delete s.brim;
            }
            delete s.qlip; delete s.diameter;
            try {
                const props = await this._pythonBridge.call('get_properties', {
                    node: this._model.node, elem: this._model.elem,
                });
                if (Number.isFinite(props?.Ixx)) { s.Ixx = props.Ixx; }
            } catch { /* Ixx 없이 — 엔진이 처짐을 평가하지 못함으로 보고 */ }
            if (options?.Fy !== undefined) { s.Fy = options.Fy; }
            if (options?.Fu !== undefined) { s.Fu = options.Fu; }
            if (s.depth && s.thickness) {
                params.section = s;
                params.__section_from_model = true;
            }
        }
        const fromModel = !!params.__section_from_model;
        delete params.__section_from_model;
        const result = await this._pythonBridge.call('analyze_loads', params);
        if (fromModel && result && typeof result === 'object' && !result.error) {
            result.section_source = 'current model (template dimensions + grosprop Ixx)';
        }
        return result;
    }

    /**
     * 포락선(x_diagram · M/V_envelope_max/min)에서 [x0, x1] 안의 점들. M · V 는 그 점의 최대 |값|.
     * 점이 없으면(구간이 격자보다 짧음) 가운데에 가장 가까운 점 하나.
     */
    private _envelopeScan(env: any, x0: number, x1: number): Array<{ x: number; M: number; V: number }> {
        const xs: number[] = env?.x_diagram;
        if (!Array.isArray(xs) || xs.length === 0) { return []; }
        const at = (i: number) => ({
            x: xs[i],
            M: Math.max(Math.abs(env?.M_envelope_max?.[i] ?? 0), Math.abs(env?.M_envelope_min?.[i] ?? 0)),
            V: Math.max(Math.abs(env?.V_envelope_max?.[i] ?? 0), Math.abs(env?.V_envelope_min?.[i] ?? 0)),
        });
        const tol = 1e-6 * Math.max(1, Math.abs(x1));
        const out: Array<{ x: number; M: number; V: number }> = [];
        for (let i = 0; i < xs.length; i++) {
            if (xs[i] >= x0 - tol && xs[i] <= x1 + tol) { out.push(at(i)); }
        }
        if (out.length > 0) { return out; }
        let iNear = 0;
        const mid = (x0 + x1) / 2;
        for (let i = 1; i < xs.length; i++) {
            if (Math.abs(xs[i] - mid) < Math.abs(xs[iNear] - mid)) { iNear = i; }
        }
        return [at(iNear)];
    }

    /** 포락선에서 x 에 가장 가까운 점 */
    private _envelopeAt(env: any, x: number): { x: number; M: number; V: number } | undefined {
        const pts = this._envelopeScan(env, x, x);
        return pts[0];
    }

    /** 세 상태 판정 합치기: 불합격 하나 → false, 그 밖에 판정 없음 하나 → null, 모두 합격 → true. */
    private static _combinePass(values: Array<boolean | null | undefined>): boolean | null {
        if (values.length === 0) { return null; }
        if (values.some((v) => v === false)) { return false; }
        if (values.some((v) => v !== true)) { return null; }
        return true;
    }

    /**
     * 퍼린(하중 분석 기반 휨 부재) 설계 — GUI 자동 계산 모드와 MCP design_purlin 의 한 길(R8-08, V3 T1–T10).
     *  1. analyze_loads (엔진 인자만)
     *  2. S-S 서명곡선 DSM: 정모멘트(상부 압축, 데크 스프링) · 부모멘트(하부 압축, 스프링 없음)
     *  3. 엔진이 나눈 구간마다 aisi_design: 정모멘트 positive_regions, 부모멘트 negative_regions,
     *     랩 lap_regions, 양력 uplift_bracing.negative_regions(하부 압축 — i621_region_eligible 인 구간에만 R)
     *     · uplift_bracing 정모멘트/랩(지점부 상부 압축). 각 구간의 Ly · Cb · M_max_abs · 구간 안 최대 |V|.
     *  4. 지점 반력의 웹 크리플링(§G5 · H3)은 그 지점을 품은 구간의 설계에 wc_P · wc_M · 지점 형식(EOF/IOF)으로.
     *  5. 판정은 세 상태로 합친다(불합격이 이기고, 미평가가 있으면 null).
     */
    private async _designPurlin(options: any): Promise<any> {
        if (!this._model.node || this._model.node.length === 0) {
            return { error: 'No section defined. Set up section in Preprocessor first.' };
        }
        const fy = options?.Fy;
        if (!(Number(fy) > 0)) {
            return { error: 'design_purlin needs Fy (design yield stress, ksi).' };
        }
        const fu = options?.Fu;
        const baseModel = this._cloneModel(this._model as any);
        const baseSignature = this._modelSignature(baseModel);
        const purlinInputRevision = this._derivedInputRevision;
        const warnings: string[] = [];
        const assumptions: string[] = [];
        const notEvaluated: string[] = [];

        // 1. 하중 분석
        const loadResult = await this._analyzeLoads({ ...options, Fy: fy, Fu: fu });
        if (!loadResult || loadResult.error) {
            return { error: `Load analysis failed: ${loadResult?.error || 'no result'}`, load_analysis: loadResult };
        }
        const ap = loadResult.auto_params || {};
        const deckInfo = ap.deck || { kphi: 0, kx: 0 };

        // 2. 서명곡선 DSM (정·부모멘트) — 설계 Fy 로 응력을 만든다
        const posSprings = this._deckSpringsForFlange(baseModel, deckInfo.kphi || 0, deckInfo.kx || 0, 'top');
        const pos = await this._signatureDsm(baseModel, 'bending_xx_pos', fy, 'Mxx', { springs: posSprings });
        const neg = await this._signatureDsm(baseModel, 'bending_xx_neg', fy, 'Mxx', { springs: [] });
        const dsmPos = pos.dsm;
        const dsmNeg = neg.dsm;
        warnings.push(...pos.warnings, ...neg.warnings);
        for (const note of [pos.classificationNote, neg.classificationNote]) {
            if (note && !assumptions.includes(note)) { assumptions.push(note); }
        }

        // 3. 단면 성질 · 치수
        const { props, cutwp, warnings: propWarnings } = await this._designProps(baseModel.node, baseModel.elem);
        warnings.push(...propWarnings);
        const geom = this._designSectionGeometry(baseModel);
        warnings.push(...geom.warnings);
        const sectionType = geom.section.type;
        const memberOpts: any = {};
        for (const k of StcfsdPanel.PURLIN_MEMBER_OPTIONS) {
            if (options?.[k] !== undefined) { memberOpts[k] = options[k]; }
        }
        const wcOpts: any = {};
        const nonWc: any = {};
        for (const [k, v] of Object.entries(memberOpts)) {
            if (k.startsWith('wc_')) { wcOpts[k] = v; } else { nonWc[k] = v; }
        }
        const baseDesign = {
            member_type: 'flexure',
            design_method: options?.design_method,
            Fy: fy, Fu: fu,
            props: { ...props, ...geom.flats },
            section: geom.section,
            section_type: sectionType,
            ...nonWc,
        };

        const gravity = loadResult.gravity || loadResult.governing || null;
        const uplift = loadResult.uplift || null;
        const unbraced = ap.unbraced || {};
        const ub = ap.uplift_bracing || null;
        const upliftR = ap.uplift_R ?? null;
        const st0 = String(options?.span_type || '');
        const i621Span = st0 === 'simple' ? 'simple' : (st0.startsWith('cont') ? 'continuous' : undefined);

        type Region = {
            id: string; kind: string; label: string; env: any; dsm: any; lap?: boolean;
            src: any; R?: number | null; flangeTop: boolean;
        };
        const regions: Region[] = [];
        // V4-26: id 는 목록마다가 아니라 이름(idTag)마다 이어 센다 — 같은 kind 를 여러 목록에서 부를 때 겹치지 않게.
        const idCount = new Map<string, number>();
        const addRegions = (list: any[], kind: string, env: any, dsm: any, labelFn: (r: any) => string,
            extra?: (r: any) => Partial<Region>, idTag: string = kind) => {
            (Array.isArray(list) ? list : []).forEach((r: any) => {
                if (!(Number(r?.M_max_abs) > 1e-9)) { return; }
                const n = (idCount.get(idTag) || 0) + 1;
                idCount.set(idTag, n);
                regions.push({
                    id: `${idTag}-${n}`, kind, label: labelFn(r), env, dsm, src: r,
                    flangeTop: r?.flange === 'top', ...(extra ? extra(r) : {}),
                });
            });
        };
        const span = (r: any) => `${Number(r.start_ft).toFixed(2)}–${Number(r.end_ft).toFixed(2)} ft`;
        // V4-22: 엔진 구간의 support 는 0 부터 — 화면 · 웹 크리플링 문장과 같게 1 부터 센 번호로.
        const supLabel = (r: any) => `지점 ${Number(r.support) + 1}${r.side === 'left' ? ' 왼쪽' : r.side === 'right' ? ' 오른쪽' : ''}`;
        addRegions(unbraced.positive_regions, 'positive', gravity, dsmPos, (r) => `정모멘트 ${span(r)}`);
        addRegions(ap.negative_regions, 'negative', gravity, dsmNeg,
            (r) => `${r.cantilever ? '내민 부모멘트' : '부모멘트'} ${span(r)}${r.support != null ? ` (${supLabel(r)})` : ''}`);
        addRegions(ap.lap_regions, 'lap', gravity, dsmNeg,
            (r) => `랩 구간 ${span(r)} (${supLabel(r)})`, () => ({ lap: true }));
        if (uplift && ub) {
            addRegions(ub.negative_regions, 'uplift', uplift, dsmNeg,
                (r) => `양력 하부압축 ${span(r)}`,
                (r) => ({ R: (r.i621_region_eligible === true && upliftR != null) ? upliftR : null }));
            // 양력의 지점부(상부 압축, 데크 지지) 구간은 엔진이 랩 끝에서 나누지 않는다 — 중력 해석의 랩 구간으로
            // 잘라 랩 안은 두 부재, 밖은 한 부재로 본다. 각 조각의 M 은 양력 포락선의 그 조각 최대 |M|.
            const lapZones: Array<[number, number]> = (Array.isArray(ap.lap_regions) ? ap.lap_regions : [])
                .map((z: any) => [Number(z.start_ft), Number(z.end_ft)] as [number, number])
                .filter((z: [number, number]) => Number.isFinite(z[0]) && Number.isFinite(z[1]) && z[1] > z[0])
                .sort((a: [number, number], b: [number, number]) => a[0] - b[0]);
            const pieces: any[] = [];
            for (const r of (Array.isArray(ub.unbraced?.positive_regions) ? ub.unbraced.positive_regions : [])) {
                const a0 = Number(r.start_ft), a1 = Number(r.end_ft);
                const cuts = [a0, a1];
                for (const [z0, z1] of lapZones) {
                    if (z0 > a0 && z0 < a1) { cuts.push(z0); }
                    if (z1 > a0 && z1 < a1) { cuts.push(z1); }
                }
                const xs = Array.from(new Set(cuts)).sort((p, q) => p - q);
                for (let k = 0; k + 1 < xs.length; k++) {
                    const s0 = xs[k], s1 = xs[k + 1];
                    if (s1 - s0 < 1e-6) { continue; }
                    const mid = (s0 + s1) / 2;
                    const inLap = lapZones.some(([z0, z1]) => mid > z0 && mid < z1);
                    const segPts = this._envelopeScan(uplift, s0, s1);
                    const top = segPts.length > 0 ? segPts.reduce((p, q) => (q.M > p.M ? q : p)) : undefined;
                    pieces.push({ ...r, start_ft: s0, end_ft: s1, M_max_abs: top ? top.M : 0,
                        x_M_max_ft: top ? top.x : mid, __lap: inLap,
                        Ly_in: inLap ? 0 : r.Ly_in, Cb: inLap ? 1.0 : r.Cb });
                }
            }
            addRegions(pieces.filter((r) => !r.__lap), 'uplift_support', uplift, dsmPos,
                (r) => `양력 지점부 상부압축 ${span(r)}`);
            addRegions(pieces.filter((r) => r.__lap), 'uplift_support', uplift, dsmPos,
                (r) => `양력 랩 구간 상부압축 ${span(r)}`, () => ({ lap: true }), 'uplift_support_lap');
            addRegions(ub.lap_regions, 'uplift_support', uplift, dsmPos,
                (r) => `양력 랩 구간 ${span(r)} (${supLabel(r)})`, () => ({ lap: true }), 'uplift_lap');
            if (upliftR == null) {
                const reasons = Array.isArray(ap.i621_check?.reasons) ? ap.i621_check.reasons.join('; ') : '';
                warnings.push('§I6.2.1 R 을 쓰지 않았습니다 — 양력 하부압축 구간은 Ly 를 쓴 횡비틀림(F2)으로 검토했습니다'
                    + (reasons ? ` (${reasons})` : ' (i621_conditions_confirmed 가 없거나 조건 밖)') + '.');
            }
        } else if (uplift && !ub) {
            notEvaluated.push('양력 구간 검토 (하중 분석이 양력 구간 정보를 내지 않음)');
        }
        if (regions.length === 0) {
            notEvaluated.push('휨 구간 없음 — 하중 분석이 설계 구간을 내지 않았습니다');
        }

        // 4. 지점 반력(웹 크리플링)을 구간에 붙인다
        const supportsAt = new Map<string, any[]>();
        const wcList: any[] = Array.isArray(loadResult.wc_reactions) ? loadResult.wc_reactions : [];
        const locs: any[] = Array.isArray(gravity?.locations) ? gravity.locations : [];
        const hasN = Number(wcOpts.wc_N) > 0;
        if (wcList.length > 0 && !hasN) {
            notEvaluated.push('§G5 웹 크리플링 · §H3 (지점 지압 길이 wc_N 이 없음)');
        }
        if (hasN) {
            for (const wc of wcList) {
                const x = Number(wc.x_ft);
                const inLap = regions.find((rg) => rg.lap && rg.kind === 'lap'
                    && x > Number(rg.src.start_ft) - 1e-6 && x < Number(rg.src.end_ft) + 1e-6);
                if (inLap) {
                    notEvaluated.push(`§G5 웹 크리플링 · §H3 — 랩 안의 지점 ${wc.support} (${wc.name}): 겹친 두 부재의 웹 크리플링은 이 도구가 모형화하지 않습니다 — 따로 검토하십시오.`);
                    continue;
                }
                const host = regions.filter((rg) => (rg.kind === 'negative' || rg.kind === 'positive')
                    && x >= Number(rg.src.start_ft) - 1e-6 && x <= Number(rg.src.end_ft) + 1e-6)
                    .sort((a, b) => (a.kind === 'negative' ? -1 : 1) - (b.kind === 'negative' ? -1 : 1))[0];
                if (!host) {
                    notEvaluated.push(`§G5 웹 크리플링 — 지점 ${wc.support} (${wc.name}): 지점을 품은 휨 구간이 없습니다.`);
                    continue;
                }
                const supLoc = locs.find((l) => l?.support === wc.support && l?.R_bearing !== undefined);
                // 지점 M: 위치 항목의 Mu(끝 지점은 null 일 수 있음 → 포락선), V: 지점 양쪽 전단 중 큰 값(V3 T3).
                const envAt = this._envelopeAt(gravity, x);
                const mAt = supLoc && Number.isFinite(supLoc.Mu) ? Math.abs(supLoc.Mu) * 12
                    : (envAt ? envAt.M * 12 : undefined);
                const vSides = [supLoc?.Vu_left, supLoc?.Vu_right].filter((v) => Number.isFinite(v)).map((v) => Math.abs(v));
                const vAt = vSides.length > 0 ? Math.max(...vSides) : envAt?.V;
                const arr = supportsAt.get(host.id) || [];
                arr.push({ ...wc, M_kipin: mAt, V_kips: vAt });
                supportsAt.set(host.id, arr);
            }
        }

        // 5. 구간마다 설계. 휨-전단(H2)은 같은 단면의 M · V 짝으로 본다:
        //   (A) 구간 최대 M(엔진 M_max_abs) + 그 위치의 V, (B) 구간 최대 V + 그 위치의 M,
        //   (C) 구간 안 지점마다 지점 M + 지점 양쪽 V 중 큰 값 + 웹 크리플링(wc_P · wc_M · 지점 형식).
        const out: any[] = [];
        for (const rg of regions) {
            const r = rg.src;
            const x0 = Number(r.start_ft), x1 = Number(r.end_ft);
            const Mu = Number(r.M_max_abs) * 12;   // kip-ft → kip-in
            const pts = this._envelopeScan(rg.env, x0, x1);
            const atMmax = r.x_M_max_ft != null ? this._envelopeAt(rg.env, Number(r.x_M_max_ft)) : undefined;
            const pV = pts.length > 0 ? pts.reduce((a, b) => (b.V > a.V ? b : a)) : undefined;
            // 하부 플랜지 압축 구간(부모멘트 · 랩 · 양력 하부압축)은 −Mxx 곡선, 상부 압축은 +Mxx(V2-06).
            const sign: '+' | '-' = rg.dsm === dsmNeg ? '-' : '+';
            const dsm = this._dsmForDesign(null, rg.dsm, fy, sign);
            const share = rg.lap ? 0.5 : 1.0;
            const params: any = { ...baseDesign, dsm, moment_sign: sign };
            if (rg.lap) {
                // 랩: 두 부재 강도의 합(매뉴얼 II-2A 가정 (a)–(c)) — 같은 뜻으로 각 부재가 M·V 의 절반을 진다.
                // 랩 안에서는 횡비틀림 · 뒤틀림을 검토하지 않는다(가정, 아래 assumptions).
                params.Lb = 0; params.Cb = 1.0;
                params.distortional_not_applicable = true;
                delete params.dsm.Mcrd;
            } else {
                // V4-20: 엔진이 구간의 Ly 를 주지 않으면 0(완전 구속)으로 채우지 않는다 — Lb 를 보내지 않아 엔진이
                // 횡비틀림을 「판정 없음」으로 밝힌다. Cb 가 없으면 보내지 않는다(엔진 1.0 + 알림).
                const ly = Number(r.Ly_in);
                if (Number.isFinite(ly)) { params.Lb = ly; }
                if (Number.isFinite(Number(r.Cb))) { params.Cb = Number(r.Cb); }
                if (r.cantilever) { params.cantilever = true; }
                // V4-03: §2.3.3.3 β — 구간 끝 모멘트 M1/M2(작은 쪽/큰 쪽, 단일곡률 −, 역곡률 +)와 Lm = 구간 Ly.
                const m1 = Number(r.M1), m2 = Number(r.M2);
                if (Number.isFinite(m1) && Number.isFinite(m2) && ly > 0) {
                    const small = Math.abs(m1) <= Math.abs(m2) ? m1 : m2;
                    const large = Math.abs(m1) <= Math.abs(m2) ? m2 : m1;
                    if (Math.abs(large) > 1e-12) {
                        params.dist_M1_M2 = -(small / large);
                        params.dist_Lm = ly;
                    }
                }
            }
            if (rg.R != null) {
                params.R_uplift = rg.R;
                // F4 V2-03: R 을 Table I6.2.1-1 과 맞춰 보려면 경간 조건이 필요하다.
                if (i621Span) { params.span_type = i621Span; }
            }
            const calls: Array<{ tag: string; p: any }> = [];
            const vA = atMmax ? atMmax.V : (pV ? pV.V : undefined);
            calls.push({ tag: 'M_max', p: { ...params, Mu: Mu * share, ...(vA !== undefined ? { Vu: vA * share } : {}) } });
            if (pV && atMmax && Math.abs(pV.x - atMmax.x) > 1e-6 && pV.V > (vA ?? 0) + 1e-9) {
                calls.push({ tag: 'V_max', p: { ...params, Mu: pV.M * 12 * share, Vu: pV.V * share } });
            }
            const sups = supportsAt.get(rg.id) || [];
            for (const s of sups) {
                if (s.M_kipin === undefined) {
                    // V4-20: 지점 M 을 모르면 0 으로 채워 검토하지 않는다.
                    notEvaluated.push(`§G5 · H3 — 지점 ${s.support} (${s.name}): 지점 모멘트를 하중 분석에서 얻지 못함`);
                    continue;
                }
                calls.push({ tag: `support ${s.support}`, p: {
                    ...params, ...wcOpts,
                    Mu: s.M_kipin * share,
                    ...(s.V_kips !== undefined ? { Vu: s.V_kips * share } : {}),
                    wc_P: s.Pu, wc_support: s.case,
                    ...(s.M_kipin !== undefined ? { wc_M: s.M_kipin } : {}),
                } });
            }
            const results: any[] = [];
            for (const c of calls) {
                let res: any;
                try {
                    res = await this._pythonBridge.call('aisi_design', c.p);
                } catch (e: any) {
                    res = { error: e?.message || String(e), pass: null };
                }
                results.push({ ...res, check_point: c.tag, Mu_checked: c.p.Mu, Vu_checked: c.p.Vu ?? null });
            }
            // 구간 대표 결과: 불합격 중 최대 이용률 → 최대 이용률
            const pick = [...results].sort((a, b) => {
                const fa = a?.pass === false ? 1 : 0, fb = b?.pass === false ? 1 : 0;
                if (fa !== fb) { return fb - fa; }
                return (Number(b?.utilization) || 0) - (Number(a?.utilization) || 0);
            })[0];
            const regionPass = StcfsdPanel._combinePass(results.map((x) => (x?.error ? null : x?.pass)));
            const notEvalRegion = Array.from(new Set(results.flatMap((x) => Array.isArray(x?.not_evaluated) ? x.not_evaluated : [])
                .map((it: any) => (typeof it === 'string' ? it : JSON.stringify(it)))));
            const result = { ...pick, pass: regionPass, not_evaluated: notEvalRegion,
                checks: results.map((x) => ({ check_point: x.check_point, Mu: x.Mu_checked, Vu: x.Vu_checked,
                    utilization: x.utilization ?? null, pass: x.error ? null : x.pass, governing_check: x.governing_check,
                    error: x.error })) };
            if (sups.length > 0) {
                result.supports_checked = sups.map((s) => ({ support: s.support, name: s.name, case: s.case, Pu: s.Pu }));
            }
            out.push({
                id: rg.id, kind: rg.kind, label: rg.label, span: r.span ?? null, support: r.support ?? null,
                side: r.side ?? null, start_ft: r.start_ft, end_ft: r.end_ft,
                Ly_in: rg.lap ? 0 : r.Ly_in, Cb: rg.lap ? 1.0 : r.Cb,
                // V4-13: 랩은 두 부재 — Mu · Vu 는 합계, 결과의 강도는 한 부재. 화면이 부재당 값을 함께 보인다.
                Mu, Vu: pV ? pV.V : null, members: rg.lap ? 2 : 1, R_uplift: rg.R ?? null,
                // V4-30: 이 구간 값을 만든 하중조합(포락의 대표 조합 — 중력 · 양력)
                combo: rg.env?.combo ?? null,
                beta_dist: typeof result?.beta_dist === 'number' ? result.beta_dist : null,
                i621_region_eligible: r.i621_region_eligible,
                result,
            });
            for (const item of notEvalRegion) {
                notEvaluated.push(`[${rg.label}] ${item}`);
            }
            if (results.some((x) => x?.error)) {
                notEvaluated.push(`[${rg.label}] 설계 오류: ${results.filter((x) => x?.error).map((x) => x.error).join('; ')}`);
            }
        }
        if (regions.some((rg) => rg.lap)) {
            assumptions.push('랩 구간: 겹친 두 부재의 강도 합(각 부재가 M · V 의 절반)으로 검토하고 랩 안의 횡비틀림 · 뒤틀림은 검토하지 않음 '
                + '(AISI Manual II-2A 가정 (a)–(c) — 기준 조항이 아닌 설계 가정).');
        }
        assumptions.push('구간의 Vu 는 그 구간 안 전단 포락선의 최대 |V| 를 구간 최대 모멘트와 함께 썼습니다(보수 측).');
        for (const a of (Array.isArray(loadResult.assumptions) ? loadResult.assumptions : [])) { assumptions.push(`[하중] ${a}`); }
        for (const w of (Array.isArray(loadResult.warnings) ? loadResult.warnings : [])) { warnings.push(`[하중] ${w}`); }
        const loadNotEvaluated = Array.isArray(loadResult.not_evaluated) ? loadResult.not_evaluated : [];

        // 6. 합친 판정 · 지배 구간
        const hostBlocks = notEvaluated.filter((s) => !s.startsWith('['));
        const pass = StcfsdPanel._combinePass([
            ...out.map((o) => (o.result?.error ? null : o.result?.pass)),
            ...(hostBlocks.length > 0 ? [null] : []),
        ]);
        const govern = (list: any[]) => [...list].sort((a, b) => {
            const fa = a.result?.pass === false ? 1 : 0, fb = b.result?.pass === false ? 1 : 0;
            if (fa !== fb) { return fb - fa; }
            return (Number(b.result?.utilization) || 0) - (Number(a.result?.utilization) || 0);
        })[0] || null;
        const governing = govern(out);
        const governingOf = (kinds: string[]) => {
            const g = govern(out.filter((o) => kinds.includes(o.kind)));
            if (!g) { return null; }
            const { result, ...region } = g;
            return { ...result, region };
        };
        const utils = out.map((o) => Number(o.result?.utilization)).filter((v) => Number.isFinite(v));

        const result = {
            load_analysis: loadResult,
            dsm_positive: dsmPos,
            dsm_negative: dsmNeg,
            regions: out,
            design_positive: governingOf(['positive']),
            design_negative: governingOf(['negative']),
            design_lap: governingOf(['lap']),
            design_uplift: governingOf(['uplift', 'uplift_support']),
            pass,
            utilization: utils.length > 0 ? Math.max(...utils) : null,
            governing: governing ? { id: governing.id, kind: governing.kind, label: governing.label, combo: governing.combo } : null,
            not_evaluated: notEvaluated,
            load_not_evaluated: loadNotEvaluated,
            warnings,
            assumptions,
            uplift_R: upliftR,
            i621_check: ap.i621_check ?? null,
            wc_reactions: wcList,
            uplift_reactions: loadResult.uplift_reactions ?? [],
            props,
            cutwp,
            deck: deckInfo,
            span_type: options?.span_type ?? null,
        };
        this._requireCurrentSignature(baseSignature, 'Purlin design');
        this._requireDerivedRevision(purlinInputRevision, 'Purlin design');
        this._lastLoadAnalysis = loadResult;
        this._lastDesignResult = result;
        // F02: 퍼린 패킷은 member 설계가 아니므로 입력 서명을 비운다.
        this._lastDesignRequest = null;
        return result;
    }

    /** MCP: 액션 처리 — Bridge에서 직접 호출 */
    public async handleMcpAction(options: any): Promise<any> {
        const action = options?.action;

        switch (action) {
            case 'generate_template': {
                const out = await this._applyTemplate(options.section_type, options.params);
                if (out.error) { return out; }
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return out;
            }

            case 'set_material': {
                // F11: ?? 기본값 + 명시 검증. 실패 시 모델을 변경하지 않는다.
                // 등방성 계약: E > 0, -1 < v < 0.5, G > 0. G 미지정 시 E/2(1+v).
                // 빠진 값은 지금 모델의 재료 값(지어낸 강재 기본값이 아님) — 무엇을 썼는지 assumptions 로 돌려준다.
                const cur = (this._model.prop && this._model.prop[0]) || [];
                const matAssumptions: string[] = [];
                const E = options.E ?? cur[1];
                const v = options.v ?? cur[3];
                if (options.E === undefined && E !== undefined) { matAssumptions.push(`E not given — kept the current E = ${E} ksi`); }
                if (options.v === undefined && v !== undefined) { matAssumptions.push(`v not given — kept the current v = ${v}`); }
                if (typeof E !== 'number' || !Number.isFinite(E) || !(E > 0)) {
                    return { error: `Invalid E: ${E} (positive finite number required)` };
                }
                if (typeof v !== 'number' || !Number.isFinite(v) || !(v > -1) || !(v < 0.5)) {
                    return { error: `Invalid v: ${v} (must satisfy -1 < v < 0.5)` };
                }
                let G = options.G;
                if (G === undefined || G === null) {
                    G = E / (2 * (1 + v));
                }
                if (typeof G !== 'number' || !Number.isFinite(G) || !(G > 0)) {
                    return { error: `Invalid G: ${options.G} (positive finite number required)` };
                }
                this._model.prop = [[100, E, E, v, v, G]];
                this._invalidateAnalysisState('Material changed', true);
                this._postMessage('modelLoaded', this._model);
                if (options.G === undefined) { matAssumptions.push(`G not given — G = E/(2(1+v)) = ${G} ksi`); }
                return { success: true, E, v, G, assumptions: matAssumptions };
            }

            case 'set_bc': {
                // 엔진이 받는 경계조건만. 빠지면 지어내지 않는다(전: 'S-S').
                const allowedBC = ['S-S', 'C-C', 'S-C', 'C-S', 'C-F', 'F-C', 'C-G', 'G-C'];
                if (!allowedBC.includes(options.BC)) {
                    return { error: `Invalid BC: ${options.BC} (one of ${allowedBC.join(', ')} required)` };
                }
                this._model.BC = options.BC;
                // 종방향 항은 BC 에 따라 서버가 다시 고른다(S-S → [1], 그 밖 → m_recommend).
                this._model.m_all = 'auto';
                this._invalidateAnalysisState('Boundary condition changed');
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, BC: this._model.BC, m_all: 'auto' };
            }

            case 'set_lengths': {
                // F12: min > 0, max ≥ min, 양의 정수 n 검증. n=1이면 단일점 [min].
                // 실패 시 기존 길이 목록을 보존한다.
                const min = options.min ?? 1;
                const max = options.max ?? 1000;
                const n = options.n ?? 50;
                if (typeof min !== 'number' || !Number.isFinite(min) || !(min > 0)) {
                    return { error: `Invalid min: ${min} (positive finite number required)` };
                }
                if (typeof max !== 'number' || !Number.isFinite(max) || !(max >= min)) {
                    return { error: `Invalid max: ${max} (must satisfy max >= min)` };
                }
                if (!Number.isInteger(n) || n < 1 || n > 10000) {
                    return { error: `Invalid n: ${n} (integer 1..10000 required)` };
                }
                const lengths: number[] = [];
                if (n === 1) {
                    lengths.push(min);
                } else {
                    for (let i = 0; i < n; i++) {
                        lengths.push(Math.pow(10, Math.log10(min) + (Math.log10(max) - Math.log10(min)) * i / (n - 1)));
                    }
                }
                this._model.lengths = lengths;
                // F1 후속 1: 길이가 바뀌면 항도 다시 — BC 에 맞게 서버가 고른다.
                this._model.m_all = 'auto';
                this._invalidateAnalysisState('Length range changed');
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                const lenAssumptions = (['min', 'max', 'n'] as const).filter((k) => options[k] === undefined)
                    .map((k) => `${k} not given — ${k} = ${k === 'min' ? min : k === 'max' ? max : n}`);
                return { success: true, n: lengths.length, m_all: 'auto', assumptions: lenAssumptions };
            }

            case 'set_load_case': {
                const lc = options.load_case || 'compression';
                if (lc === 'custom') {
                    // R8-16: custom 은 실제 하중의 응력 그대로(재척도 없음) — LF 는 적용 하중의 배수다.
                    // 순수 성분이어도 family 를 추론하지 않는다(DSM 추출은 순수 하중 case 로 한다).
                    this._invalidateAnalysisState(`Load case changed: ${lc}`);
                    await this._applyStressToModel(this._model as any, {
                        type: 'custom',
                        P: options.P ?? 0, Mxx: options.Mxx ?? 0, Mzz: options.Mzz ?? 0,
                    });
                    (this._model as any).loadCase = 'custom';
                    (this._model as any).loadValues = { P: options.P ?? 0, Mxx: options.Mxx ?? 0, Mzz: options.Mzz ?? 0 };
                    this._postMessage('modelLoaded', this._model);
                    return { success: true, load_case: 'custom', reference: 'applied loads',
                        max_stress: this._getAnalysisFy() };
                }
                // 순수 분포의 기준응력. 빠지면 지금 모델의 기준응력 — 그것도 없으면 지어내지 않는다.
                const fy = options.fy ?? ((this._model as any).loadFy > 0 ? (this._model as any).loadFy : undefined);
                if (!(Number(fy) > 0)) {
                    return { error: `set_load_case '${lc}' needs fy (reference stress, ksi) — the model has none yet.` };
                }
                this._invalidateAnalysisState(`Load case changed: ${lc}`);
                await this._setLoadCaseOnModel(this._model as any, lc, fy,
                    { P: options.P, Mxx: options.Mxx, Mzz: options.Mzz });
                (this._model as any).loadCase = lc;
                (this._model as any).loadFy = fy;
                this._postMessage('modelLoaded', this._model);
                return { success: true, load_case: lc, fy, reference: 'fy-scaled distribution' };
            }

            case 'set_stress': {
                if ((options.type === 'uniform_compression' || options.type === 'pure_bending')
                    && !(Number(options.fy ?? (this._model as any).loadFy) > 0)) {
                    return { error: `set_stress '${options.type}' needs fy (reference stress, ksi).` };
                }
                await this._applyStressToModel(this._model as any, options);
                // stress 타입에서 loadCase 추론 (해석탭에서 setStress만 보내는 경우 대비)
                if (options.type === 'uniform_compression') {
                    (this._model as any).loadCase = 'compression';
                } else if (options.type === 'pure_bending') {
                    (this._model as any).loadCase = 'bending_xx_pos';
                } else if (options.type === 'custom') {
                    // R8-16: fy 로 다시 척도한 경우에만 순수 성분을 family 로 본다. 실하중이면 custom.
                    (this._model as any).loadCase = options.fy
                        ? this._inferCustomLoadCase(options.P, options.Mxx, options.Mzz)
                        : 'custom';
                }
                this._invalidateAnalysisState('Stress distribution changed');
                this._postMessage('modelLoaded', this._model);
                return { success: true, load_case: (this._model as any).loadCase };
            }

            case 'run_analysis': {
                if (options.neigs !== undefined) {
                    const neigs = Number(options.neigs);
                    if (!Number.isInteger(neigs) || neigs < 1 || neigs > 50) {
                        throw new Error('neigs must be an integer between 1 and 50.');
                    }
                    const mAll = this._model.m_all;
                    const mTerms = Array.isArray(mAll) && Array.isArray(mAll[0]) ? mAll[0].length : 1;
                    let freeDofs = 0;
                    for (const nd of this._model.node || []) {
                        for (let k = 3; k <= 6; k++) { if (nd[k]) { freeDofs++; } }
                    }
                    const maxEigs = Math.max(freeDofs * mTerms, 1);
                    if (neigs > maxEigs) {
                        throw new Error(`neigs ${neigs} exceeds available DOFs (${maxEigs}).`);
                    }
                    this._model.neigs = neigs;
                }
                const { result, dsm, dsmError, warnings } = await this._performAnalysis();
                const curve = Array.isArray(result?.curve) ? result.curve : [];
                const neigsActual = Array.isArray(curve[0]) ? curve[0].length - 1 : 0;
                const sel = result?.m_all_selection || null;
                const mAllUsed = Array.isArray(result?.m_all) ? result.m_all : [];
                const out: any = {
                    success: true,
                    n_lengths: result.n_lengths,
                    lengths_analyzed: this._resultLengths(result).length,
                    // 실제로 푼 길이(폐기 길이 제외) — get_energy_recovery 의 length_index 는 이 배열의 색인(W2 후속 6).
                    lengths: this._resultLengths(result),
                    discarded_lengths: result.discarded_lengths || [],
                    m_all_selection: sel,
                    m_terms_max: mAllUsed.reduce((m: number, t: any) => Math.max(m, Array.isArray(t) ? t.length : 0), 0),
                    warnings,
                    classification_status: this._lastAnalysisResult?.classification_status ?? null,
                    neigs_requested: this._model.neigs ?? 10,
                    neigs_actual: neigsActual,
                    load_case: (this._model as any).loadCase ?? null,
                    load_family: this._lastAnalysisResult?._meta?.load_family,
                    fy_reference: this._lastAnalysisResult?._meta?.fy,
                };
                if (dsm) {
                    out.dsm_P = dsm.P; out.dsm_Mxx = dsm.Mxx; out.dsm_Mzz = dsm.Mzz;
                    if (dsm.warning) { out.dsm_warning = dsm.warning; }
                }
                if (dsmError) { out.dsm_error = dsmError; }
                return out;
            }

            case 'get_dsm': {
                const curve = this._isAnalysisCurrent() ? this._lastAnalysisResult?.curve : null;
                if (!curve || curve.length === 0) {
                    return this._staleAnalysisError();
                }

                // R2-05: 요청 family가 해석 family와 일치해야 한다.
                const requested = options.load_type || 'P';
                if (requested !== 'P' && requested !== 'Mxx' && requested !== 'Mzz') {
                    return { error: `Invalid load_type: ${requested} (P, Mxx, or Mzz required)` };
                }
                const family = this._lastAnalysisResult?._meta?.load_family;
                const loadCase = this._lastAnalysisResult?._meta?.load_type;
                if (family !== requested) {
                    return {
                        error: `DSM load_type '${requested}' does not match analysis family ` +
                            `'${family ?? 'none'}' (load_case ${loadCase}). ` +
                            `Re-run analysis with a matching load case.`,
                    };
                }
                // R8-01: 곡선의 LF 는 해석 기준응력에 대한 배수다 — DSM 은 언제나 그 fy 로 추출한다.
                // 다른 fy 를 주면(설계 Fy 나 SI 값을 넣은 실수) 조용히 쓰지 않고 거절한다.
                const aFy = this._lastAnalysisResult?._meta?.fy || this._getAnalysisFy();
                if (options.fy !== undefined && options.fy !== null) {
                    const given = Number(options.fy);
                    if (!(Math.abs(given - aFy) <= 1e-6 * Math.max(1, Math.abs(aFy)))) {
                        return {
                            error: `fy=${options.fy} differs from the analysis reference stress ${aFy} ksi. `
                                + 'DSM values are extracted with the stress the curve was computed for; omit fy, '
                                + 'or re-run the analysis (set_load_case fy=...) at the stress you want.',
                        };
                    }
                }
                // 선택: 유효좌굴길이 제공 시 전체좌굴값을 AISI 폐형식(Eq.E2-4 / §F2.1)으로 산정.
                const base: any = {
                    node: this._model.node, elem: this._model.elem,
                    curve, fy: aFy, load_type: requested,
                    Cb: options.Cb, section_type: options.section_type,
                    classifications: this._lastAnalysisResult?.classifications,
                    BC: this._lastAnalysisResult?._meta?.BC || this._model.BC,
                };
                if (requested === 'P') {
                    base.KxLx = options.KxLx; base.KyLy = options.KyLy; base.KtLt = options.KtLt;
                } else {
                    base.Lb = options.Lb;
                }
                try {
                    const dsm = await this._callDsm(base);
                    const usesGlobal = (base.KxLx ?? base.KyLy ?? base.KtLt ?? base.Lb) != null;
                    return { [requested]: dsm, fy_used: aFy, load_family: family,
                        section_type_used: usesGlobal
                            ? (base.section_type ?? this._sectionTypeForEngine(this._model)) : undefined };
                } catch (e: any) {
                    return { error: e?.message || String(e) };
                }
            }

            case 'prepare_design_dsm': {
                // 설계 Fy 로 응력을 만든다(지어낸 강종 기본값 없음). Py·My 는 설계에 넘기지 않는다.
                const fy = options.fy ?? options.Fy;
                const memberType = String(options.member_type || 'flexure');
                if (!this._model.node?.length || !this._model.elem?.length) {
                    return { error: 'No section model available. Generate or load a section first.' };
                }

                const requiredFamilies: Array<'P' | 'Mxx'> = memberType === 'compression'
                    ? ['P']
                    : memberType === 'combined'
                        ? ['P', 'Mxx']
                        : memberType === 'flexure'
                            ? ['Mxx']
                            : [];
                if (requiredFamilies.length === 0) {
                    return { success: true, message: 'This member type does not require DSM buckling values.' };
                }
                if (!(Number(fy) > 0)) {
                    return { error: 'prepare_design_dsm needs the design Fy (ksi) to build the reference stress distribution.' };
                }

                const baseModel = this._cloneModel(this._model as any);
                const preparedSignature = this._currentDesignDsmSignature(fy);
                const prepared: any = { fy_analysis: fy, warnings: [] as string[] };
                const preparedCases: string[] = [];
                for (const family of requiredFamilies) {
                    const loadCase = family === 'P' ? 'compression' : 'bending_xx_pos';
                    const sig = await this._signatureDsm(baseModel, loadCase, fy, family);
                    if (family === 'P') { prepared.P = sig.dsm; } else { prepared.Mxx = sig.dsm; }
                    prepared.warnings.push(...sig.warnings);
                    if (sig.classificationNote) {
                        prepared.assumptions = Array.from(new Set([...(prepared.assumptions || []), sig.classificationNote]));
                    }
                    prepared[`${family}_classification_status`] = sig.classification_status;
                    preparedCases.push(loadCase);
                }

                if (preparedSignature !== this._currentDesignDsmSignature(fy)) {
                    throw new Error('Design DSM result discarded because the model changed while it was running.');
                }
                this._preparedDesignDsm = prepared;
                this._preparedDesignDsmSig = preparedSignature;
                return {
                    success: true,
                    member_type: memberType,
                    load_cases: preparedCases,
                    dsm: prepared,
                    warnings: prepared.warnings,
                    message: `Prepared S-S signature-curve FSM analyses for ${preparedCases.join(', ')} without changing the current analysis view.`,
                };
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
                    this._invalidateAnalysisState('Doubled section geometry changed', true);
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
                // 엔진 dict 그대로(전송 키 action · units 만 뺀다) — 모르는 키는 엔진이 경고로 돌려준다.
                const result = await this._pythonBridge.call('lap_connection', this._dictParams(options));
                this._postMessage('lapConnectionResult', result);
                return result;
            }

            case 'check_lap_length': {
                return await this._pythonBridge.call('check_lap_length',
                    this._kwParams('check_lap_length', options));
            }

            case 'design_connection': {
                const request = this._dictParams(options);
                const connResult = await this._pythonBridge.call('design_connection', request);
                // 요청 입력(t1/t2/d/n/weld_size/groove_type 등)을 결과에 함께 — 도면이 실제 입력을 그리도록.
                // 결과 필드가 우선한다.
                this._postMessage('connectionResult', { request, ...request, ...connResult });
                return connResult;
            }

            case 'shear_lag':
            case 'block_shear':
            case 'cold_work':
            case 'flange_curling': {
                // F08: 함수별 allowlist(엔진 함수의 인자 이름 그대로)로 업무 인자만 전달한다.
                const params = this._kwParams(action, options);
                if (params.error) { return params; }
                return await this._pythonBridge.call(action, params);
            }

            case 'classify': {
                // classify_detailed: status · code · message 를 함께 돌려준다(W1 후속 4).
                return await this._classifyCurrent(options.GBTcon);
            }

            // --- #19: run_vibration ---
            case 'vibration': {
                // 밀도는 사용자가 줄 때만(kip·s²/in⁴). 없으면 엔진의 강재 값 + DEFAULT_DENSITY 경고(F3 후속).
                // 길이: 사용자가 진동 길이(options.lengths, in)를 주면 그것만, 아니면 좌굴 해석의 길이 · 항.
                let lengths: number[];
                let m_all: number[][];
                let source: string;
                if (Array.isArray(options.lengths) && options.lengths.length > 0) {
                    if (options.lengths.some((L: any) => !(typeof L === 'number' && L > 0))) {
                        return { error: 'vibration lengths must be positive numbers (in)' };
                    }
                    lengths = options.lengths;
                    if (this._model.BC === 'S-S') {
                        m_all = lengths.map(() => [1]);
                        source = 'S-S: m = 1';
                    } else {
                        const rec = await this._pythonBridge.call('m_recommend', {
                            prop: this._model.prop, node: this._model.node, elem: this._model.elem, lengths,
                        });
                        m_all = rec.m_all;
                        source = `m_recommend (${rec.method || 'signature'})`;
                    }
                } else {
                    ({ lengths, m_all, source } = await this._resolvedTerms());
                }
                // V4-02: 크기를 미리 알린다 — DOF = 4 × 절점 × 항, 고유치 풀이 비용 ≈ DOF³(F3: 3108 DOF 에서 길이당 약 2.2 s).
                // 큰 요청은 사용자가 확인(confirm_large)해야 시작한다. 요청을 몰래 줄이지 않는다.
                const nn = this._model.node?.length || 0;
                const dofs = m_all.map((t) => 4 * nn * (Array.isArray(t) ? t.length : 1));
                const estimateS = dofs.reduce((s, d) => s + 2.2 * Math.pow(d / 3108, 3), 0);
                // V4-35: 엔진 호출의 시간 제한(넘으면 취소)을 넘는 요청은 확인해도 실행하지 않는다 — 반드시 취소된다.
                const limitS = Math.round((Number((this._pythonBridge as any).timeoutMs) || 300000) / 1000);
                const perLen = lengths.length > 0 ? estimateS / lengths.length : 0;
                const fitLengths = perLen > 0 ? Math.max(1, Math.floor((0.8 * limitS) / perLen)) : lengths.length;
                const size = { n_lengths: lengths.length, dof_max: Math.max(0, ...dofs),
                    terms_max: Math.max(0, ...m_all.map((t) => (Array.isArray(t) ? t.length : 1))), estimate_s: Math.round(estimateS),
                    limit_s: limitS, exceeds_limit: estimateS > limitS, lengths_that_fit: fitLengths };
                const shrink = `줄이려면: 진동 길이를 부재 길이 몇 개로 지정(진동 길이 칸 — 지금 조건에서 약 ${fitLengths}개 이하), `
                    + 'S-S 경계조건(항 1개), 또는 더 성긴 메시.';
                if (size.exceeds_limit) {
                    return {
                        needs_confirmation: false, exceeds_limit: true, size, m_all_source: source,
                        error: `진동 해석을 실행하지 않았습니다: 예상 약 ${size.estimate_s} s 가 엔진 호출 시간 제한 ${limitS} s 를 넘습니다 `
                            + `(길이 ${size.n_lengths}개 · 길이당 최대 ${size.terms_max}항 · 최대 DOF ${size.dof_max}) — 실행해도 취소됩니다. ${shrink}`,
                    };
                }
                if (estimateS > 60 && !options.confirm_large) {
                    return {
                        needs_confirmation: true, size, m_all_source: source,
                        // GUI 는 「그래도 실행」 단추로, MCP 는 confirm_large: true 로 다시 요청한다(confirm_param).
                        confirm_param: 'confirm_large',
                        message: `진동 해석이 큽니다: 길이 ${size.n_lengths}개 · 길이당 최대 ${size.terms_max}항 · 최대 DOF ${size.dof_max} — `
                            + `예상 약 ${size.estimate_s} s(제한 ${limitS} s). ${shrink}`,
                    };
                }
                const params: any = {
                    node: this._model.node, elem: this._model.elem,
                    prop: this._model.prop, lengths, m_all,
                    BC: this._model.BC,
                    springs: (this._model as any).springs || [],
                    constraints: (this._model as any).constraints || [],
                    neigs: this._model.neigs,
                    GBTcon: (this._model as any).GBTcon,
                };
                if (options.rho !== undefined && options.rho !== null) { params.rho = options.rho; }
                const result = await this._pythonBridge.call('vibration', params);
                this._requireSuccessfulAnalysis(result, 'Vibration analysis');
                const vibWarnings = (Array.isArray(result?.diagnostics) ? result.diagnostics : [])
                    .filter((d: any) => d?.severity === 'warning' || d?.severity === 'error')
                    .map((d: any) => d.message || d.code);
                return { ...result, lengths, m_all_source: source, size, warnings: vibWarnings };
            }

            // --- #20: run_plastic_surface ---
            case 'plastic': {
                if (!(Number(options.fy) > 0)) {
                    return { error: 'plastic surface needs fy (ksi).' };
                }
                const pp: any = { node: this._model.node, elem: this._model.elem, fy: options.fy };
                // 격자 인자는 줄 때만(엔진 기본 n_theta 36 · n_na 21 · n_thick 10) — W2 후속 1.
                for (const k of ['n_theta', 'n_na', 'n_fibers_per_elem', 'n_thick']) {
                    if (options[k] !== undefined && options[k] !== null) { pp[k] = options[k]; }
                }
                const result = await this._pythonBridge.call('plastic', pp);
                this._postMessage('plasticResult', result);
                return result;
            }

            // --- AISI Design ---
            case 'aisi_design': {
                // GUI(runDesign)와 MCP(aisi_design_*)가 같은 조립 함수를 쓴다(R8-08).
                const result = await this._designMember(options);
                this._postMessage('designResult', result);
                return result;
            }


            case 'aisi_guide': {
                const result = await this._pythonBridge.call('aisi_guide', this._dictParams(options));
                return result;
            }

            case 'steel_grades': {
                const sp = this._kwParams('steel_grades', options);
                if (sp.error) { return sp; }
                const result = await this._pythonBridge.call('steel_grades', sp);
                return result;
            }

            case 'web_crippling': {
                const wp = this._kwParams('web_crippling', options);
                if (wp.error) { return wp; }
                const result = await this._pythonBridge.call('web_crippling', wp);
                return result;
            }

            case 'analyze_loads': {
                const loadInputRevision = this._derivedInputRevision;
                const result = await this._analyzeLoads(options);
                this._requireDerivedRevision(loadInputRevision, 'Load analysis');
                if (!result?.error) { this._lastLoadAnalysis = result; }
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
                    } catch (e: any) { (reportData.errors ||= []).push(`section_props: ${e?.message || e}`); }
                    try {
                        reportData.cutwp_props = await this._pythonBridge.call('cutwp', {
                            node: this._model.node, elem: this._model.elem
                        });
                    } catch (e: any) { (reportData.errors ||= []).push(`cutwp_props: ${e?.message || e}`); }
                }

                // 2. DSM 값 (R2-05: 해석 family와 일치하는 항목만)
                if (this._isAnalysisCurrent()) {
                    reportData.dsm_basis = {
                        load_family: this._lastAnalysisResult?._meta?.load_family,
                        load_case: this._lastAnalysisResult?._meta?.load_type,
                    };
                    try {
                        const dsm = await this._extractCurrentAnalysisDsm();
                        reportData.dsm_P = dsm.P;
                        reportData.dsm_Mxx = dsm.Mxx;
                        reportData.dsm_Mzz = dsm.Mzz;
                        reportData.dsm_load_family = dsm.load_family;
                        reportData.dsm_warning = dsm.warning;
                    } catch (e: any) { (reportData.errors ||= []).push(`dsm: ${e?.message || e}`); }
                    reportData.curve_length = this._lastAnalysisResult.curve.length;
                    reportData.analysis_meta = this._lastAnalysisResult._meta || null;
                }
                const reportFy = options.Fy ?? options.fy ?? this._getAnalysisFy();
                if (this._preparedDsmMatchesCurrent(reportFy)) {
                    reportData.prepared_design_dsm = this._preparedDesignDsm;
                }

                // 3. 하중 분석 (옵션)
                if (this._lastLoadAnalysis) {
                    reportData.load_analysis = this._lastLoadAnalysis;
                } else if (options.loads) {
                    try {
                        reportData.load_analysis = await this._analyzeLoads(options);
                    } catch (e: any) { (reportData.errors ||= []).push(`load_analysis: ${e?.message || e}`); }
                }

                // 4. 설계 결과
                // F01: action을 제외한 업무 입력으로 명시적 dispatch (재귀 방지).
                // F02: 요청과 일치하는 캐시만 재사용하고, 다르면 새로 계산한다.
                if (options.member_type) {
                    if (this._designCacheMatches(options)) {
                        reportData.design_result = this._lastDesignResult;
                        reportData.design_cache_hit = true;
                    } else {
                        try {
                            const { action: _action, ...designOptions } = options;
                            void _action;
                            const designResult = await this.handleMcpAction({ ...designOptions, action: 'aisi_design' });
                            reportData.design_result = designResult;
                            reportData.design_cache_hit = false;
                        } catch (e: any) { (reportData.errors ||= []).push(`design_result: ${e?.message || e}`); }
                    }
                } else if (this._lastDesignResult) {
                    reportData.design_result = this._lastDesignResult;
                    reportData.design_cache_hit = true;
                }

                return reportData;
            }

            case 'capture_section_preview': {
                // R8-18: 요청마다 새 파일. 이번 캡처가 파일을 쓴 경우에만 경로를 돌려준다 — 오류·시간 초과에
                // 이전 PNG 를 성공으로 돌려주지 않는다. 대기 중인 요청이 있으면 그것을 먼저 끝낸다.
                if (this._previewResolve) {
                    this._previewResolve({ error: 'Superseded by a newer capture request.' });
                    this._previewResolve = null;
                }
                this._previewSeq += 1;
                const target = path.join(os.tmpdir(), `cufsm_section_preview_${process.pid}_${this._previewSeq}.png`);
                this._previewTargetPath = target;
                return new Promise((resolve) => {
                    this._previewResolve = resolve;
                    this._postMessage('captureSection', null);
                    setTimeout(() => {
                        if (this._previewResolve === resolve) {
                            this._previewResolve({ error: 'Capture timeout (5 s) — the webview did not answer.' });
                            this._previewResolve = null;
                        }
                    }, 5000);
                }).then((result: any) => {
                    if (result?.error) {
                        return { error: String(result.error) };
                    }
                    if (result?.__written_path !== target) {
                        return { error: 'Section preview was not written for this request.' };
                    }
                    const { png_base64: _png, __written_path: _w, ...meta } = result;
                    void _png; void _w;
                    this._lastPreviewPath = target;
                    return { success: true, file_path: target, ...meta };
                });
            }

            case 'calc_deck_stiffness': {
                const dp = this._kwParams('calc_deck_stiffness', options);
                if (dp.error) { return dp; }
                const result = await this._pythonBridge.call('calc_deck_stiffness', dp);
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
                valData.analysis_current = this._isAnalysisCurrent();
                valData.last_load_analysis = this._lastLoadAnalysis || null;
                valData.last_design_result = this._lastDesignResult || null;

                // Properties
                if (node.length > 0) {
                    try {
                        valData.props = await this._pythonBridge.call('get_properties', { node, elem });
                    } catch (e: any) { (valData.errors ||= []).push(`props: ${e?.message || e}`); }
                    try {
                        valData.cutwp = await this._pythonBridge.call('cutwp', { node, elem });
                    } catch (e: any) { (valData.errors ||= []).push(`cutwp: ${e?.message || e}`); }
                }

                // Analysis/DSM (R2-05: 해석 family와 일치하는 항목만)
                valData.analysis_run = this._isAnalysisCurrent();
                if (this._isAnalysisCurrent()) {
                    valData.dsm_basis = {
                        load_family: this._lastAnalysisResult?._meta?.load_family,
                        load_case: this._lastAnalysisResult?._meta?.load_type,
                    };
                    try {
                        const dsm = await this._extractCurrentAnalysisDsm();
                        valData.dsm_P = dsm.P;
                        valData.dsm_Mxx = dsm.Mxx;
                        valData.dsm_Mzz = dsm.Mzz;
                        valData.dsm_load_family = dsm.load_family;
                        valData.dsm_warning = dsm.warning;
                    } catch (e: any) { (valData.errors ||= []).push(`dsm: ${e?.message || e}`); }
                }

                // R8-28: 요청한 설계 Fy 로 준비된 설계용 DSM 이 있으면 함께(없으면 null).
                valData.prepared_design_dsm = options.Fy !== undefined && this._preparedDsmMatchesCurrent(options.Fy)
                    ? this._preparedDesignDsm : null;
                valData.Fy = options.Fy ?? null;
                valData.status = this.getStatus();
                return valData;
            }

            case 'apply_deck_springs': {
                // 데크 강성(kφ, kx)을 압축 플랜지에 스프링으로 적용 (F06: 10열 계약)
                const kphi = options.kphi || 0;
                const kx = options.kx || 0;
                const flange = options.flange === 'bottom' ? 'bottom' : 'top';
                const springs = this._deckSpringsForFlange(this._model, kphi, kx, flange);
                (this._model as any).springs = springs;
                this._invalidateAnalysisState('Deck springs applied');
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nsprings: springs.length, flange };
            }

            case 'design_purlin': {
                // 하중 분석 → 정·부모멘트 서명곡선 DSM → 구간별 설계. GUI(자동 계산 모드)와 MCP 의 한 길(R8-08).
                const result = await this._designPurlin(options);
                if (!result?.error) {
                    this._postMessage('loadAnalysisComplete', result.load_analysis);
                }
                this._postMessage('designPurlinResult', result);
                return result;
            }

            // --- #21: save_project ---
            case 'save_project': {
                // R8-09: 원시 모델 파일만(.stcfsd / .json), 절대 경로만. 화면 .csd 와 같은 _openProject 로도 열린다.
                const fp = String(options.filepath || '');
                const ext = path.extname(fp).toLowerCase();
                if (!fp || !path.isAbsolute(fp)) {
                    return { error: `save_project needs an absolute filepath (got '${fp}')` };
                }
                if (ext !== '.stcfsd' && ext !== '.json') {
                    return { error: `save_project writes a raw model file: extension .stcfsd or .json required (got '${ext || 'none'}')` };
                }
                try {
                    const data = JSON.stringify({ format: 'stcfsd-model', version: '1.0', ...this._cloneModel(this._model) }, null, 2);
                    const tmp = `${fp}.tmp-${process.pid}`;
                    fs.writeFileSync(tmp, data, 'utf8');
                    fs.renameSync(tmp, fp);
                } catch (e: any) {
                    return { error: `save_project failed: ${e?.message || e}` };
                }
                return { success: true, filepath: fp };
            }

            case 'load_project': {
                let data: any;
                try {
                    data = JSON.parse(fs.readFileSync(String(options.filepath), 'utf-8'));
                } catch (e: any) {
                    return { error: `load_project failed: ${e?.message || e}` };
                }
                // save_project 출력(원시 모델)과 .csd 래퍼({model}) 모두 허용
                const model = (data && data.model) ? data.model : data;
                const check = this._checkLoadedModel(model);
                if (check.error) { return { error: `Invalid project file: ${check.error}` }; }
                this._model = { ...this._model, ...check.model };
                this._invalidateAnalysisState('Project loaded', true);
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, filepath: options.filepath, warnings: check.warnings };
            }

            // --- #22: run_signature_curve ---
            case 'signature_ss': {
                // R8-23: 사용자 BC · 길이 · 항을 바꾸지 않는다. 엔진 signature_ss(요소폭 기반 길이, S-S, m = 1)를
                // 임시로 풀고, 결과 _meta 에 BC 'S-S' 와 실제 응력의 family 를 적는다.
                this._invalidateAnalysisState('Signature-curve analysis started');
                const snapshot = this._cloneModel(this._model);
                const signature = this._modelSignature(snapshot);
                const loadType = (snapshot as any).loadCase || 'unknown';
                const analysisFy = this._getAnalysisFy(snapshot);
                const result = await this._pythonBridge.call('signature_ss', {
                    prop: snapshot.prop, node: snapshot.node, elem: snapshot.elem,
                    neigs: snapshot.neigs, GBTcon: (snapshot as any).GBTcon,
                });
                this._requireSuccessfulAnalysis(result, 'Signature-curve analysis');
                const lengths = this._resultLengths(result);
                if (!Array.isArray(result.m_all)) { result.m_all = lengths.map(() => [1]); }
                const classDetail = await this._classifyAnalysis({ ...snapshot, BC: 'S-S' }, result);
                this._requireCurrentSignature(signature, 'Signature-curve analysis');
                this._setAnalysisResult(result, loadType, signature, analysisFy, { BC: 'S-S', kind: 'signature_ss' });
                const warnings = this._analysisWarnings(result);
                this._lastAnalysisResult.analysis_warnings = warnings;
                this._attachClassification(classDetail);
                this._postMessage('analysisComplete', this._lastAnalysisResult);
                return { success: true, n_lengths: lengths.length, BC: 'S-S', load_case: loadType,
                    load_family: this._analysisFamily(loadType), warnings,
                    discarded_lengths: result.discarded_lengths || [] };
            }

            // --- #23: set_node_stress ---
            case 'set_node_stress': {
                const nodeIds: number[] = options.node_ids || [];
                const stress: number = options.stress || 0;
                // F16: 실제 수정된 절점만 집계하고 invalid_ids를 보고한다.
                let updated = 0;
                const invalidIds: number[] = [];
                for (const id of nodeIds) {
                    if (Number.isInteger(id) && id >= 1 && id <= this._model.node.length) {
                        this._model.node[id - 1][7] = stress;
                        updated++;
                    } else {
                        invalidIds.push(id);
                    }
                }
                if (updated > 0) {
                    this._markCustomStress();
                    this._invalidateAnalysisState('Nodal stresses changed');
                }
                this._postMessage('modelLoaded', this._model);
                return { success: true, updated, invalid_ids: invalidIds,
                    load_case: (this._model as any).loadCase ?? null };
            }

            // --- #24: get_buckling_curve ---
            case 'get_curve': {
                if (!this._isAnalysisCurrent()) {
                    return this._staleAnalysisError();
                }
                return { curve: this._lastAnalysisResult.curve };
            }

            // --- #25: set_springs ---
            case 'set_springs': {
                const springs: number[][] = options.springs || [];
                // F1 후속 6: 엔진 계약(10 열 [#, nodei, nodej, ku, kv, kw, kq, orient, discrete, ys], 절점 범위) — 적용 전에 거절.
                const nn = this._model.node?.length || 0;
                for (let i = 0; i < springs.length; i++) {
                    const row = springs[i];
                    if (!Array.isArray(row) || row.length !== 10 || row.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
                        return { error: `Invalid spring row ${i + 1}: 10 finite numbers required [#, nodei, nodej, ku, kv, kw, kq, orient, discrete, ys]` };
                    }
                    if (!Number.isInteger(row[1]) || row[1] < 1 || row[1] > nn || !Number.isInteger(row[2]) || row[2] < 0 || row[2] > nn) {
                        return { error: `Invalid spring row ${i + 1}: nodei 1..${nn}, nodej 0..${nn} (0 = ground)` };
                    }
                }
                (this._model as any).springs = springs;
                this._invalidateAnalysisState('Springs changed');
                this._postMessage('modelLoaded', this._model);
                return { success: true, nsprings: springs.length };
            }

            // --- #26: set_constraints ---
            case 'set_constraints': {
                const constraints: number[][] = options.constraints || [];
                (this._model as any).constraints = constraints;
                this._invalidateAnalysisState('Constraints changed');
                this._postMessage('modelLoaded', this._model);
                return { success: true, nconstraints: constraints.length };
            }

            // --- set_nodes: 전체 절점 배열 교체 ---
            case 'set_nodes': {
                try {
                    const nodes: number[][] = options.nodes || [];
                    this._validateNodeRows(nodes);
                    // R2-02: 후보 절점과 함께 commit될 요소 집합을 교차 검증한다.
                    // elements를 함께 주면 동시 교체, 아니면 현재 요소를 유지한다.
                    const jointElems: number[][] | undefined = options.elements;
                    const elems = jointElems !== undefined ? jointElems : (this._model.elem || []);
                    try {
                        this._validateElemRows(elems, nodes);
                    } catch (e: any) {
                        throw new Error(`${e.message} — set_nodes would orphan existing elements ` +
                            `(pass 'elements' together for joint replacement)`, { cause: e });
                    }
                    this._model.node = nodes;
                    if (jointElems !== undefined) {
                        this._model.elem = jointElems;
                    }
                    this._markCustomStress();
                    this._invalidateAnalysisState('Nodes replaced');
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                    return { success: true, nnodes: nodes.length, nelems: this._model.elem.length };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- set_elements: 전체 요소 배열 교체 ---
            case 'set_elements': {
                try {
                    const elements: number[][] = options.elements || [];
                    this._validateElemRows(elements, this._model.node || []);
                    this._model.elem = elements;
                    this._invalidateAnalysisState('Elements replaced');
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                    return { success: true, nelems: elements.length };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- add_node: 절점 1개 추가 ---
            case 'add_node': {
                try {
                    const x = options.x ?? 0, z = options.z ?? 0, stress = options.stress ?? 0;
                    this._requireFinite(x, 'x');
                    this._requireFinite(z, 'z');
                    this._requireFinite(stress, 'stress');
                    const nodeArr = this._model.node || [];
                    const newId = nodeArr.length + 1;
                    nodeArr.push([newId, x, z, 1, 1, 1, 1, stress]);
                    this._markCustomStress();
                    this._model.node = nodeArr;
                    this._invalidateAnalysisState('Node added');
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                    return { success: true, node_id: newId, nnodes: nodeArr.length };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- add_element: 요소 1개 추가 ---
            case 'add_element': {
                try {
                    this._requireElementEnds(options.nodei, options.nodej);
                    const t = this._requireThickness(options.thickness);
                    const elemArr = this._model.elem || [];
                    const newElemId = elemArr.length + 1;
                    const matnum = (this._model.prop && this._model.prop[0]) ? this._model.prop[0][0] : 100;
                    elemArr.push([newElemId, options.nodei, options.nodej, t, matnum]);
                    this._model.elem = elemArr;
                    this._invalidateAnalysisState('Element added');
                    this._postMessage('modelLoaded', this._model);
                    this._updateTreeView();
                    return { success: true, elem_id: newElemId, nelems: elemArr.length };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- modify_node: 절점 좌표/응력 수정 ---
            case 'modify_node': {
                try {
                    const nid = this._requireNodeId(options.node_id);
                    if (options.x !== undefined) { this._requireFinite(options.x, 'x'); }
                    if (options.z !== undefined) { this._requireFinite(options.z, 'z'); }
                    if (options.stress !== undefined) { this._requireFinite(options.stress, 'stress'); }
                    // R2-03: 후보 좌표를 임시 적용한 상태에서 연결 요소 길이를 검사한다.
                    if (options.x !== undefined || options.z !== undefined) {
                        const nd = this._model.node[nid - 1];
                        const cx = options.x !== undefined ? options.x : nd[1];
                        const cz = options.z !== undefined ? options.z : nd[2];
                        const tol = this._zeroLengthTol();
                        for (const el of this._model.elem || []) {
                            const other = el[1] === nid ? el[2] : (el[2] === nid ? el[1] : 0);
                            if (other >= 1) {
                                const on = this._model.node[other - 1];
                                this._requirePositiveLength(cx, cz, on[1], on[2],
                                    `element ${el[0]} after moving node ${nid}`, tol);
                            }
                        }
                    }
                    const nd = this._model.node[nid - 1];
                    if (options.x !== undefined) { nd[1] = options.x; }
                    if (options.z !== undefined) { nd[2] = options.z; }
                    if (options.stress !== undefined) { nd[7] = options.stress; this._markCustomStress(); }
                    this._invalidateAnalysisState('Node modified');
                    this._postMessage('modelLoaded', this._model);
                    return { success: true, node: nd };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- delete_node: 절점 삭제 + 연결 요소 제거 ---
            case 'delete_node': {
                let dnid: number;
                try {
                    dnid = this._requireNodeId(options.node_id);
                } catch (e: any) {
                    return { error: e.message };
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
                this._invalidateAnalysisState('Node deleted', true);
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nnodes: this._model.node.length, nelems: this._model.elem.length };
            }

            // --- modify_element: 요소 두께/연결 수정 ---
            case 'modify_element': {
                try {
                    const eid = this._requireElemId(options.elem_id);
                    if (options.thickness !== undefined) { this._requireThickness(options.thickness); }
                    const el = this._model.elem[eid - 1];
                    const newI = options.nodei !== undefined ? options.nodei : el[1];
                    const newJ = options.nodej !== undefined ? options.nodej : el[2];
                    if (options.nodei !== undefined || options.nodej !== undefined) {
                        this._requireElementEnds(newI, newJ);
                    }
                    if (options.thickness !== undefined) { el[3] = options.thickness; }
                    if (options.nodei !== undefined) { el[1] = options.nodei; }
                    if (options.nodej !== undefined) { el[2] = options.nodej; }
                    this._invalidateAnalysisState('Element modified');
                    this._postMessage('modelLoaded', this._model);
                    return { success: true, element: el };
                } catch (e: any) {
                    return { error: e.message };
                }
            }

            // --- delete_element: 요소 삭제 ---
            case 'delete_element': {
                let deid: number;
                try {
                    deid = this._requireElemId(options.elem_id);
                } catch (e: any) {
                    return { error: e.message };
                }
                this._model.elem.splice(deid - 1, 1);
                this._model.elem.forEach((e: number[], i: number) => { e[0] = i + 1; });
                this._invalidateAnalysisState('Element deleted', true);
                this._postMessage('modelLoaded', this._model);
                this._updateTreeView();
                return { success: true, nelems: this._model.elem.length };
            }

            // --- #28: energy_recovery ---
            case 'energy_recovery': {
                if (!this._isAnalysisCurrent()) {
                    return this._staleAnalysisError();
                }
                const li = options.length_index ?? 0;
                const mi = options.mode_index ?? 0;
                const shapes = this._lastAnalysisResult.shapes || [];
                const curve = this._lastAnalysisResult.curve || [];
                // F09: 인덱스를 실제 shape 열 수·곡선 길이 수로 검증한다.
                if (!Number.isInteger(li) || li < 0 || li >= shapes.length || li >= curve.length) {
                    return { error: `length_index ${li} out of range (0..${Math.min(shapes.length, curve.length) - 1})` };
                }
                const shapeMatrix = shapes[li];
                const curveRow = curve[li];
                const nModes = Array.isArray(curveRow) ? curveRow.length - 1 : 0;
                const shapeCols = Array.isArray(shapeMatrix) && Array.isArray(shapeMatrix[0])
                    ? shapeMatrix[0].length : nModes;
                const maxMode = Math.min(nModes, shapeCols);
                if (!Number.isInteger(mi) || mi < 0 || mi >= maxMode) {
                    return { error: `mode_index ${mi} out of range (0..${maxMode - 1})` };
                }
                let modeVec: number[];
                if (Array.isArray(shapeMatrix[0])) {
                    modeVec = shapeMatrix.map((row: number[]) => row[mi] || 0);
                } else {
                    modeVec = shapeMatrix;
                }
                // W1 후속 2 · 7: 곡선 행의 길이와 그 길이에서 실제로 쓴 종방향 항(다항 해석이면 [1] 이 아님),
                // 곡선이 푼 BC 를 넘긴다 — 그래야 모드 벡터의 DOF 배치가 맞는다.
                const resLengths = this._resultLengths(this._lastAnalysisResult);
                const length = resLengths[li] ?? curveRow?.[0];
                const mTerms = Array.isArray(this._lastAnalysisResult.m_all) ? this._lastAnalysisResult.m_all[li] : undefined;
                const erParams: any = {
                    node: this._model.node,
                    elem: this._model.elem,
                    prop: this._model.prop,
                    mode: modeVec,
                    length,
                    BC: this._lastAnalysisResult._meta?.BC || this._model.BC,
                };
                if (Array.isArray(mTerms)) { erParams.m_a = mTerms; }
                const result = await this._pythonBridge.call('energy_recovery', erParams);
                const erAssumptions = [
                    ...(options.length_index === undefined ? ['length_index not given — 0 (shortest analysed length)'] : []),
                    ...(options.mode_index === undefined ? ['mode_index not given — 0 (first mode)'] : []),
                ];
                return { ...result, length, m_a: mTerms ?? null, assumptions: erAssumptions };
            }

            // --- get_full_state: 전체 모델+해석 상태 ---
            case 'get_full_state': {
                const status = this.getStatus();
                const result: any = { ...status };

                // 해석 결과 요약 (F03: current 결과만 요약한다)
                if (this._isAnalysisCurrent() && this._lastAnalysisResult.curve) {
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
                    // CUFSM 기본(ospace 1 · orth 2 · couple 1 · norm 1) — 엔진 GBTConfig 기본과 같게(F2/F3 후속).
                    ospace: options.ospace ?? 1,
                    norm: options.norm ?? 1,
                    couple: options.couple ?? 1,
                    orth: options.orth ?? 2,
                    glob: options.glob || [],
                    dist: options.dist || [],
                    local: options.local || [],
                    other: options.other || [],
                };
                this._invalidateAnalysisState('cFSM constraints changed');
                this._postMessage('modelLoaded', this._model);
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

    private async _runVibration(data?: any): Promise<void> {
        try {
            // 밀도는 화면 입력(kip·s²/in⁴, 단위 변환 뒤)을 그대로 — 비우면 엔진의 강재 값 + 경고.
            const rho = data && data.rho !== undefined && data.rho !== null ? data.rho : undefined;
            const result = await this.handleMcpAction({ action: 'vibration', ...(rho !== undefined ? { rho } : {}),
                ...(Array.isArray(data?.lengths) && data.lengths.length > 0 ? { lengths: data.lengths } : {}),
                ...(data?.confirm_large ? { confirm_large: true } : {}) });
            this._postMessage('vibrationResult', result);
        } catch (err: any) {
            this._postMessage('vibrationError', { error: err.message });
        }
    }

    /** 보고서 PDF 저장 (Edge/Chrome headless --print-to-pdf) */
    /** 좌굴해석 결과를 별도 웹뷰 패널에 표시 (PDF 저장 버튼 포함) */
    private _showBucklingReport(html: string): void {
        this._bucklingReportHtml = html;
        if (this._bucklingReportPanel) {
            this._bucklingReportPanel.webview.html = this._wrapBucklingReport(html);
            this._bucklingReportPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'stcfsd.bucklingReport',
            '좌굴해석 결과 보고서',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        this._bucklingReportPanel = panel;
        panel.onDidDispose(() => { this._bucklingReportPanel = undefined; });
        panel.webview.onDidReceiveMessage(async (msg) => {
            if (msg?.command === 'savePdf') {
                await this._saveReportPdf({ html: this._buildPrintableBucklingHtml() });
            }
        });
        panel.webview.html = this._wrapBucklingReport(html);
    }

    /** 인쇄용 완결 HTML (흰 배경, 이미지 배경 유지) */
    private _buildPrintableBucklingHtml(): string {
        return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>좌굴해석 결과 보고서</title>
<style>body{font-family:'Segoe UI',sans-serif;color:#111;background:#fff;max-width:800px;margin:0 auto;padding:24px;font-size:13px}
h1{font-size:18px;border-bottom:2px solid #333;padding-bottom:6px}h2{font-size:14px;margin-top:20px;color:#0b5394}
table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}td,th{border:1px solid #999;padding:4px 8px;text-align:left}
img{max-width:100%}.chart{background:#1e1e1e;padding:8px;border-radius:4px;margin:6px 0}</style></head>
<body>${this._bucklingReportHtml}</body></html>`;
    }

    /** 웹뷰 패널용 래핑 (툴바 + CSP) */
    private _wrapBucklingReport(inner: string): string {
        const nonce = getNonce();
        return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>body{font-family:var(--vscode-font-family,sans-serif);color:var(--vscode-editor-foreground);background:var(--vscode-editor-background);padding:16px;font-size:13px;max-width:860px;margin:0 auto}
h1{font-size:16px;border-bottom:2px solid var(--vscode-foreground);padding-bottom:6px}h2{font-size:13px;margin-top:18px;color:#4fc3f7}
table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}td,th{border:1px solid var(--vscode-panel-border,#555);padding:4px 8px;text-align:left}
img{max-width:100%}.chart{background:#1e1e1e;padding:8px;border-radius:4px;margin:6px 0}
.toolbar{position:sticky;top:0;background:var(--vscode-editor-background);padding:8px 0;border-bottom:1px solid var(--vscode-panel-border,#555);margin-bottom:10px;z-index:10}
.toolbar button{background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:3px;padding:6px 16px;cursor:pointer;font-weight:600}</style>
</head><body>
<div class="toolbar"><button id="btn-pdf">PDF / HTML 저장</button> <span style="opacity:0.6;font-size:11px">저장 대화상자에서 .pdf 또는 .html 선택</span></div>
${inner}
<script nonce="${nonce}">const v=acquireVsCodeApi();document.getElementById('btn-pdf').addEventListener('click',()=>v.postMessage({command:'savePdf'}));</script>
</body></html>`;
    }

    private async _saveReportPdf(data: { html: string }): Promise<void> {
        try {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('CUFSM_Report.pdf'),
                filters: { 'PDF Files': ['pdf'], 'HTML Files': ['html'] },
                title: '보고서 PDF 저장',
            });
            if (!uri) return;

            // HTML로 저장 선택 시 기존 방식
            if (uri.fsPath.endsWith('.html')) {
                const encoder = new TextEncoder();
                await vscode.workspace.fs.writeFile(uri, encoder.encode(data.html));
                vscode.window.showInformationMessage(`보고서가 저장되었습니다: ${uri.fsPath}`);
                return;
            }

            // PDF: 임시 HTML 파일 생성 → headless 브라우저로 변환
            const tmpHtml = path.join(os.tmpdir(), `cufsm_report_${Date.now()}.html`);
            fs.writeFileSync(tmpHtml, data.html, 'utf-8');

            const browserPath = this._findBrowser();
            if (!browserPath) {
                // 브라우저 없으면 HTML 폴백
                fs.unlinkSync(tmpHtml);
                const htmlPath = uri.fsPath.replace(/\.pdf$/i, '.html');
                fs.writeFileSync(htmlPath, data.html, 'utf-8');
                vscode.window.showWarningMessage(
                    `Edge/Chrome을 찾을 수 없어 HTML로 저장했습니다: ${htmlPath}`
                );
                return;
            }

            // 임시 사용자 데이터 디렉터리 (실행 중인 Edge와 프로필 충돌 방지)
            const tmpUserData = path.join(os.tmpdir(), `cufsm_pdf_${Date.now()}`);
            fs.mkdirSync(tmpUserData, { recursive: true });

            const fileUrl = 'file:///' + tmpHtml.split(path.sep).join('/');
            const pdfPath = uri.fsPath;

            // spawn 사용 (execFile/spawnSync는 Windows에서 PDF flush 문제 발생)
            await new Promise<void>((resolve, reject) => {
                const proc = cp.spawn(browserPath, [
                    '--headless=new',
                    '--disable-gpu',
                    '--no-sandbox',
                    '--no-pdf-header-footer',
                    '--user-data-dir=' + tmpUserData,
                    '--print-to-pdf=' + pdfPath,
                    fileUrl,
                ], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });

                proc.on('error', (err) => {
                    this._cleanupTempFiles(tmpHtml, tmpUserData);
                    reject(err);
                });

                proc.on('close', (code) => {
                    // Edge가 종료 후에도 PDF가 디스크에 flush되는 데 시간이 걸림
                    const checkPdf = (retries: number) => {
                        try {
                            const stat = fs.statSync(pdfPath);
                            if (stat.size > 0) {
                                this._cleanupTempFiles(tmpHtml, tmpUserData);
                                resolve();
                                return;
                            }
                        } catch { /* not yet */ }
                        if (retries > 0) {
                            setTimeout(() => checkPdf(retries - 1), 500);
                        } else {
                            this._cleanupTempFiles(tmpHtml, tmpUserData);
                            reject(new Error(
                                `PDF 파일이 생성되지 않았습니다 (Edge headless 종료 코드: ${code ?? 'unknown'})`
                            ));
                        }
                    };
                    // 500ms 간격으로 최대 10회 (5초) 대기
                    setTimeout(() => checkPdf(10), 500);
                });
            });

            vscode.window.showInformationMessage(`PDF가 저장되었습니다: ${uri.fsPath}`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`PDF 저장 실패: ${err.message}`);
        }
    }

    private _cleanupTempFiles(tmpHtml: string, tmpUserData: string): void {
        try { fs.unlinkSync(tmpHtml); } catch { /* ignore */ }
        try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    /** 시스템에 설치된 Edge 또는 Chrome 경로 탐색 */
    private _findBrowser(): string | null {
        const candidates = process.platform === 'win32'
            ? [
                path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
                path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            ]
            : process.platform === 'darwin'
            ? [
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            ]
            : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];

        for (const p of candidates) {
            try {
                fs.accessSync(p, fs.constants.X_OK);
                return p;
            } catch { /* not found, try next */ }
        }
        return null;
    }

    /** cFSM 모드 분류 — 웹뷰 버튼에서 호출. 모델/해석결과는 확장 측 상태에서 구성한다. */
    private async _classifyModes(data: any): Promise<void> {
        try {
            const result = await this._classifyCurrent(data?.GBTcon);
            if (result?.error) {
                this._postMessage('classifyError', { error: result.error });
            }
            // 성공 시 _classifyCurrent 가 classifyResult 를 보낸다.
        } catch (err: any) {
            this._postMessage('classifyError', { error: err.message });
        }
    }

    /**
     * 현재 해석 결과를 다시 분류(GUI 버튼 · MCP classify_modes 의 한 길). 최신 해석만 — 옛 모델의
     * 모드를 새 모델로 분류하지 않는다. 곡선이 푼 BC(서명곡선이면 S-S)와 실제 길이·항을 쓴다.
     */
    private async _classifyCurrent(GBTcon?: any): Promise<any> {
        if (!this._isAnalysisCurrent()) {
            return this._staleAnalysisError();
        }
        const analysis = this._lastAnalysisResult;
        const model = { ...this._cloneModel(this._model as any), BC: analysis._meta?.BC || this._model.BC };
        if (GBTcon) { model.GBTcon = GBTcon; }
        const detail = await this._classifyAnalysis(model, analysis);
        if (!detail) {
            return { error: 'No mode shapes in the current analysis result.' };
        }
        this._attachClassification(detail);
        return detail;
    }

    /**
     * 진동 해석 등 m_all 목록이 필요한 호출의 길이·항. 최신 좌굴 해석이 있으면 그것이 실제로 쓴 것,
     * 없으면 S-S 는 [1], 그 밖은 서버 m_recommend(F1 후속 1). 지어낸 항을 쓰지 않는다.
     */
    private async _resolvedTerms(): Promise<{ lengths: number[]; m_all: number[][]; source: string }> {
        const mAll = this._model.m_all;
        const lengths = this._model.lengths || [];
        if (Array.isArray(mAll) && mAll.length === lengths.length && lengths.length > 0) {
            return { lengths, m_all: mAll as number[][], source: 'model' };
        }
        if (this._isAnalysisCurrent() && Array.isArray(this._lastAnalysisResult?.m_all)
            && (this._lastAnalysisResult._meta?.BC || this._model.BC) === this._model.BC) {
            return { lengths: this._resultLengths(this._lastAnalysisResult), m_all: this._lastAnalysisResult.m_all,
                source: 'current buckling analysis' };
        }
        if (this._model.BC === 'S-S') {
            return { lengths, m_all: lengths.map(() => [1]), source: 'S-S: m = 1' };
        }
        const rec = await this._pythonBridge.call('m_recommend', {
            prop: this._model.prop, node: this._model.node, elem: this._model.elem, lengths,
        });
        return { lengths, m_all: rec.m_all, source: `m_recommend (${rec.method || 'signature'})` };
    }

    /** 단면 템플릿 생성 */
    private async _generateTemplate(data: { section_type: string; params: any }): Promise<void> {
        try {
            // MCP set_section_template 과 같은 _applyTemplate(R8-03 의 하중 표지 포함).
            const out = await this._applyTemplate(data.section_type, data.params);
            if (out.error) {
                this._postMessage('templateError', { error: out.error });
                return;
            }
            this._postMessage('templateGenerated', {
                node: this._model.node, elem: this._model.elem,
                validation: out.validation, warnings: out.warnings,
                section_type: out.section_type, load_case: out.load_case,
            });
            this._postMessage('modelLoaded', this._model);
            this._updateTreeView();
        } catch (err: any) {
            this._postMessage('templateError', { error: err.message });
        }
    }

    /** 응력 분포 적용 */
    private async _applyStress(data: any): Promise<void> {
        try {
            const result = await this._pythonBridge.call('stresgen', data);
            this._invalidateAnalysisState('Stress distribution regenerated');
            this._postMessage('stressApplied', result);
        } catch (err: any) {
            this._postMessage('stressError', { error: err.message });
        }
    }

    /** WebView로 메시지 전송 */
    private _postMessage(command: string, data: any): void {
        if (isTestMode()) {
            this._testPostedMessages.push(JSON.parse(JSON.stringify({ command, data })));
            if (this._testPostedMessages.length > 100) {
                this._testPostedMessages.shift();
            }
        }
        if (!this._disposed) {
            this._panel.webview.postMessage({ command, data });
        }
    }

    /** WebView HTML 생성 */
    private _getHtmlForWebview(): string {
        const webview = this._panel.webview;
        const nonce = getNonce();
        // 재료 칸의 처음 값(SI 화면) — 기본 강종 한 행에서(steelGrades.ts). 호스트 loadFy 도 같은 행이다.
        const steelFy = mpaField(defaultSteel().Fy);
        const steelFu = mpaField(defaultSteel().Fu);

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'css', 'theme.css')
        );
        const designStateUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'designState.js')
        );
        const utilsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'js', 'utils.js')
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
    <!-- 탭 바 + 파일 버튼: [좌굴해석 ①②③] | [부재설계 ④⑤] | [출력] 3그룹 워크플로 -->
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="preprocessor">① 단면·재료</button>
        <button class="tab-btn" data-tab="loads">② 하중계산</button>
        <span class="tab-sep"></span>
        <button class="tab-btn" data-tab="design">③ 좌굴해석·부재설계</button>
        <button class="tab-btn" data-tab="connection">④ 접합부</button>
        <span class="tab-sep"></span>
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
                    <h3>단면 입력 (Section Input)</h3>
                    <p class="hint">템플릿 또는 절점/요소 직접 입력으로 단면 형상을 정의합니다.</p>
                    <div class="section-group">
                        <label>단면 템플릿 (Section Template)</label>
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
                            <button id="btn-generate-template" class="btn-action-green" style="padding:4px 12px">단면 생성</button>
                        </div>
                        <div id="template-params" class="input-row" style="margin-top:4px; flex-wrap:wrap;">
                            <label>H<span class="hint-inline" data-unit="length">mm</span></label><input type="number" id="tpl-H" value="100" step="1" style="width:60px">
                            <label>B<span class="hint-inline" data-unit="length">mm</span></label><input type="number" id="tpl-B" value="50" step="1" style="width:60px">
                            <label>D<span class="hint-inline" data-unit="length">mm</span></label><input type="number" id="tpl-D" value="20" step="1" style="width:60px">
                            <label>t<span class="hint-inline" data-unit="thickness">mm</span></label><input type="number" id="tpl-t" value="2.3" step="0.1" style="width:60px">
                            <label>r<span class="hint-inline" data-unit="radius">mm</span></label><input type="number" id="tpl-r" value="4" step="0.5" style="width:60px">
                            <span id="tpl-qlip-group" style="display:none">
                                <label>lip°<span class="hint-inline">립각도</span></label><input type="number" id="tpl-qlip" value="90" step="5" min="0" max="180" style="width:68px">
                            </span>
                        </div>
                        <p class="hint" id="tpl-dim-hint" style="margin:2px 0 0"></p>
                    </div>
                    <div class="section-group">
                        <label>재료 (Material)</label>
                        <p class="hint">강종 선택 시 Fy, Fu, E, G가 자동 설정됩니다. 여기서 설정한 Fy/Fu가 해석·설계·접합부 탭 전체에 적용됩니다 (단일 소스).</p>
                        <div class="input-row">
                            <label>Steel</label>
                            <select id="input-steel-grade" style="width:110px">
                                <option value="">-- Manual --</option>
                                ${steelGradeOptionsHtml()}
                            </select>
                        </div>
                        <div class="input-row">
                            <label>Fy<span class="hint-inline" data-unit="stress">MPa</span></label><input type="number" id="input-fy" value="${steelFy}" step="5" style="width:60px">
                            <label>Fu<span class="hint-inline" data-unit="stress">MPa</span></label><input type="number" id="input-fu" value="${steelFu}" step="5" style="width:60px">
                        </div>
                        <div class="input-row">
                            <label>E<span class="hint-inline" data-unit="stress">MPa</span></label><input type="number" id="input-E" value="203395" step="1000">
                            <label>v</label><input type="number" id="input-v" value="0.3" step="0.01">
                            <label>G<span class="hint-inline" data-unit="stress">MPa</span></label><input type="number" id="input-G" value="77911" step="1000">
                        </div>
                        <div class="input-row" style="margin-top:6px">
                            <label><input type="checkbox" id="chk-cold-work" checked> §A3.3.2 Cold Work (냉간가공 Fya)</label>
                            <span class="hint-inline">(코너부 강도 증가)</span>
                        </div>
                    </div>
                    <div class="section-group">
                        <label>절점 (Nodes) <button id="btn-add-node" class="btn-small">+ 추가</button></label>
                        <p class="hint">절점 좌표(x, z)와 응력(stress). 표에서 직접 수정하면 단면·성질이 즉시 갱신됩니다. 응력은 해석 탭의 Load Case 선택 시 해석 실행 전에 자동 설정됩니다.</p>
                        <div id="node-table-container" class="table-container">
                            <table id="node-table">
                                <thead><tr><th>#</th><th>x</th><th>z</th><th>stress</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                    <div class="section-group">
                        <label>요소 (Elements) <button id="btn-add-elem" class="btn-small">+ 추가</button></label>
                        <p class="hint">요소 연결(ni→nj)과 두께(t). 각 요소는 하나의 판(strip)을 나타내며, 두께를 표에서 직접 수정할 수 있습니다.</p>
                        <div id="elem-table-container" class="table-container">
                            <table id="elem-table">
                                <thead><tr><th>#</th><th>ni</th><th>nj</th><th>t</th></tr></thead>
                                <tbody></tbody>
                            </table>
                        </div>
                    </div>
                </div>
                <div class="panel-right">
                    <h3>단면 미리보기 (Cross Section Preview)</h3>
                    <p class="hint">중심선(centerline) 모델. 주황색 점 = 절점, 파란색 선 = 요소.</p>
                    <div id="section-preview">
                        <svg id="section-svg" viewBox="-1 -1 12 12" preserveAspectRatio="xMidYMid meet"></svg>
                    </div>
                    <div id="section-props" class="props-display"></div>
                </div>
            </div>
        </div>

        <!-- ② 하중계산 탭 -->
        <div id="tab-loads" class="tab-panel">
            <p class="hint">부재 유형을 선택하고 부재 구성(스팬·지점·랩)·사용하중(미계수 면압)을 입력한 뒤 "하중 분석 실행"을 누르면, 하중조합(LRFD/ASD)을 적용한 소요강도(Mu·Vu)가 아래에, 비지지길이·Cb가 ③좌굴해석·부재설계 탭에, 랩 길이·지점 Mu/Vu가 ④접합부 탭에 자동 입력됩니다.</p>
            <p id="loads-tab-hint" class="hint" style="display:none;color:var(--vscode-editorWarning-foreground,#f90)">"직접 입력" 모드입니다 — 자동 하중계산(스팬/사용하중) 대신 아래 소요강도(Pu·Vu·Mu)를 직접 입력한 후 ③탭에서 설계 검토를 실행하세요.</p>
            <div class="panel-row">
                <div class="panel-left" style="max-width:360px">
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
                <p id="member-mode-badge" class="hint" style="margin:2px 0 8px"></p>

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
                        <label>간격<span class="hint-inline" data-unit="length_ft">m</span></label>
                        <input type="number" id="config-spacing" value="1.0" step="0.1" style="width:68px">
                    </div>

                    <!-- 스팬/지점/랩 테이블 -->
                    <div id="span-table-container" style="margin-top:6px;overflow-x:auto">
                        <table id="span-config-table" style="width:100%;font-size:10px;border-collapse:collapse;border:1px solid var(--vscode-panel-border)">
                            <thead>
                                <tr style="background:var(--vscode-editor-selectionBackground)">
                                    <th style="padding:3px 4px;width:32px">#</th>
                                    <th style="padding:3px 4px;width:60px">지점</th>
                                    <th style="padding:3px 4px;width:70px">스팬(<span data-unit="length_ft">m</span>)</th>
                                    <th style="padding:3px 4px;width:60px">랩L(<span data-unit="length_ft">m</span>)</th>
                                    <th style="padding:3px 4px;width:60px">랩R(<span data-unit="length_ft">m</span>)</th>
                                </tr>
                            </thead>
                            <tbody id="span-config-tbody">
                                <!-- JS에서 동적 생성 -->
                            </tbody>
                        </table>
                        <p class="hint" style="font-size:9px;margin-top:2px">지점: P=핀, R=롤러, F=고정단, N=자유단. 랩=지점 양측 겹침 길이.</p>
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> 데크 & 가새</h3>
                <div>
                    <div class="input-row">
                        <label>데크</label>
                        <select id="select-deck-type" style="width:140px">
                            <option value="through-fastened">관통 체결</option>
                            <option value="standing-seam">스탠딩 심</option>
                            <option value="none" selected>없음</option>
                        </select>
                    </div>
                    <div class="input-row" id="deck-detail-row">
                        <label>t<span class="hint-inline" data-unit="thickness">mm</span></label>
                        <input type="number" id="deck-t-panel" value="0.5" step="0.1" style="width:68px">
                        <label>@<span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="deck-fastener-spacing" value="300" step="10" style="width:55px">
                    </div>
                    <div class="input-row" id="deck-kphi-row">
                        <label>kφ override<span class="hint-inline" data-unit="rotStiff">kN-m/rad/m</span></label>
                        <input type="number" id="deck-kphi-override" value="" step="0.001" style="width:70px" placeholder="auto">
                    </div>
                    <div class="input-row" id="deck-kx-row">
                        <label>kx override<span class="hint-inline" data-unit="latStiff">kN/m/m</span></label>
                        <input type="number" id="deck-kx-override" value="" step="0.01" style="width:70px" placeholder="auto">
                    </div>
                    <p class="hint">auto 값은 예비설계 근사치입니다. 프로젝트별 데크·체결부 시험값이 있으면 override를 사용하세요.</p>
                    <div class="input-row">
                        <label>이산 브레이스 위치<span class="hint-inline" data-unit="length_ft">m</span></label>
                        <input type="text" id="brace-points" value="" placeholder="예: 3.0, 6.0 (비우면 없음)" style="width:150px" title="보 왼쪽 끝에서 잰 위치, 쉼표로 구분 (양 플랜지 횡구속)">
                    </div>
                    <p class="hint" style="margin:4px 0 2px"><b>§I6.2.1 양력 R 계수법</b> — 확인하지 않으면 R 을 쓰지 않고 양력 구간을 횡비틀림(Ly)으로 검토합니다.</p>
                    <div class="input-row">
                        <label><input type="checkbox" id="chk-i621-confirmed"> §I6.2.1 조건 (i)–(n) 확인 (데크·체결 상세가 조건을 만족)</label>
                    </div>
                    <div class="input-row">
                        <label>단열재 두께 t<sub>i</sub><span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="deck-insulation" value="" step="1" style="width:60px" placeholder="없음" title="단순보 R 보정 r = 1 − 0.01·t_i (Eq. I6.2.1-2)">
                        <label>스탠딩심 시험 R</label>
                        <input type="number" id="deck-R-tested" value="" step="0.01" min="0" max="1" style="width:55px" placeholder="—" title="AISI S908 시험으로 정한 R (스탠딩심 데크)">
                    </div>
                </div>

                <h3 class="collapsible" data-expanded="true"><span class="collapse-icon">▾</span> 사용하중 입력 <span class="hint-inline" style="font-weight:normal">(미계수 면압, Service Loads)</span></h3>
                <div>
                    <p class="hint" style="margin-bottom:4px">지붕/벽 면압(D·Lr·S·W)을 입력하면 "하중 분석 실행"이 하중조합을 적용해 아래 <b>소요강도</b>(Mu·Vu)와 ③탭의 비지지길이·Cb를 자동 계산·입력합니다.</p>
                    <div class="input-row">
                        <label>D<span class="hint-inline" data-unit="pressure">kPa</span></label>
                        <input type="number" id="load-D-psf" value="0.3" step="0.05" style="width:50px">
                        <span id="load-D-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row" id="load-Lr-row">
                        <label>Lr<span class="hint-inline" data-unit="pressure">kPa</span></label>
                        <input type="number" id="load-Lr-psf" value="1.0" step="0.1" style="width:50px">
                        <span id="load-Lr-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row" id="load-S-row">
                        <label>S<span class="hint-inline" data-unit="pressure">kPa</span></label>
                        <input type="number" id="load-S-psf" value="0.5" step="0.1" style="width:50px">
                        <span id="load-S-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row" id="load-W-row">
                        <label>Wu<span class="hint-inline" data-unit="pressure">kPa</span>↑</label>
                        <input type="number" id="load-Wu-psf" value="1.0" step="0.1" style="width:50px">
                        <span id="load-Wu-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row" id="load-Wp-row">
                        <label>Wp<span class="hint-inline" data-unit="pressure">kPa</span>↓</label>
                        <input type="number" id="load-Wp-psf" value="0" step="0.1" style="width:50px">
                        <span id="load-Wp-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row" id="load-L-row" style="display:none">
                        <label>L<span class="hint-inline" data-unit="pressure">kPa</span></label>
                        <input type="number" id="load-L-psf" value="0" step="0.1" style="width:50px">
                        <span id="load-L-plf" class="hint-inline" style="min-width:50px">→</span>
                    </div>
                    <div class="input-row">
                        <label><input type="checkbox" id="chk-pattern-loading" checked> 활하중 부분재하(패턴) 검토</label>
                    </div>
                    <div class="input-row">
                        <label><input type="checkbox" id="chk-lr-reduced"> 지붕 활하중 감소 적용 (ASCE 7 §4.8.2 로 Lr &lt; 20 psf — 이때만 Lr 부분재하)</label>
                    </div>
                    <div class="input-row">
                        <label>경간별 Ix<span class="hint-inline" data-unit="inertia">mm⁴</span></label>
                        <input type="text" id="span-Ix-list" value="" placeholder="비우면 모든 경간 같은 Ix" style="width:170px" title="경간 수만큼 쉼표로 (끝·안 부재 두께가 다를 때)">
                    </div>
                </div>

                <button id="btn-analyze-loads" class="btn-action-green" style="margin-top:8px;width:100%">하중 분석 실행</button>
                </div>

                <h3>소요강도 <span class="hint-inline" style="font-weight:normal">(계수하중 조합값, Required Strength)</span></h3>
                <p class="hint" style="margin-bottom:4px">자동 계산 모드: 위 "하중 분석 실행" 시 지배 조합의 Mu·Vu가 자동 입력됩니다. 직접 입력 모드: 하중조합(LRFD/ASD)으로 산정한 값을 직접 입력한 후 ③탭에서 설계 검토를 실행하세요.</p>
                <div class="input-row">
                    <label>Pu<span class="hint-inline" data-unit="force">kN</span></label>
                    <input type="number" id="design-P" value="0" step="1" style="width:65px" title="소요 압축강도 (계수 축력)">
                    <label>Vu<span class="hint-inline" data-unit="force">kN</span></label>
                    <input type="number" id="design-V" value="0" step="1" style="width:65px" title="소요 전단강도 (계수 전단력)">
                </div>
                <div class="input-row">
                    <label>Mu(+)<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="design-Mx-pos" value="0" step="0.1" style="width:65px" title="정모멘트 소요강도">
                    <label>Mu(-)<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="design-Mx" value="0" step="0.1" style="width:65px" title="부모멘트 소요강도">
                </div>
                <div class="input-row">
                    <label>Muy<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="design-My" value="0" step="0.1" style="width:65px" title="약축 모멘트 소요강도">
                </div>
                <div class="input-row">
                    <label>May<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="design-May-strength" value="0" step="0.1" style="width:65px">
                    <span class="hint-inline">약축 가용강도 직접 입력 (Muy 검토용)</span>
                </div>
                </div>
                <div class="panel-right">
                <div id="load-analysis-section" style="display:none">
                <h3>하중 분석 결과</h3>
                <div id="load-analysis-result" class="result-box" style="font-size:12px">
                </div>
                </div>
                </div>
            </div>
        </div>

    <!-- ========== Design Tab ========== -->
    <div id="tab-design" class="tab-panel">
        <!-- Step Indicator -->
        <div class="step-indicator" id="design-step-indicator">
            <div class="step-item active" data-step="1"><span class="step-num">1</span><span>입력</span></div>
            <div class="step-line" id="step-line-12"></div>
            <div class="step-item" data-step="2" id="step-item-2"><span class="step-num">2</span><span>하중 분석</span></div>
            <div class="step-line" id="step-line-23"></div>
            <div class="step-item" data-step="3"><span class="step-num">3</span><span>설계 검토</span></div>
        </div>
        <!-- 좌굴해석(①~③) 연동 상태: 설계는 FSM/DSM 좌굴값을 소비한다 -->
        <div id="design-dsm-status" class="hint" style="margin:0 0 10px;padding:5px 8px;border:1px solid var(--vscode-panel-border);border-radius:3px">
            FSM 좌굴값 없음 — 아래 "A. 좌굴해석" 섹션에서 해석을 실행하세요 (설계용 좌굴값 자동 준비).
        </div>

        <!-- ── A. 좌굴해석 (구 해석 탭 통합) ── -->
        <h3 class="collapsible" id="sec-fsm" data-expanded="true" style="margin-bottom:6px"><span class="collapse-icon">▾</span> A. 좌굴해석 (FSM) — 입력·실행</h3>
        <div id="sec-fsm-body">
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
                    <span class="hint" style="margin-left:8px" id="analysis-fy-display">Fy: ${steelFy} MPa</span>
                </div>
                <div id="custom-load-inputs" class="input-row" style="display:none; margin-top:4px;">
                    <label>P<span class="hint-inline" data-unit="force">kN</span></label>
                    <input type="number" id="input-load-P" value="0" step="1" style="width:70px">
                    <label>Mxx<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="input-load-Mxx" value="0" step="1" style="width:70px">
                    <label>Mzz<span class="hint-inline" data-unit="moment">kN-m</span></label>
                    <input type="number" id="input-load-Mzz" value="0" step="1" style="width:70px">
                </div>
                <p class="hint" id="custom-load-hint" style="display:none"></p>
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
                    <label>최소<span class="hint-inline" data-unit="length">mm</span></label><input type="number" id="input-len-min" value="10" step="10">
                    <label>최대<span class="hint-inline" data-unit="length">mm</span></label><input type="number" id="input-len-max" value="10000" step="1000">
                    <label>개수</label><input type="number" id="input-len-n" value="60" step="10">
                </div>
                <p class="hint" id="analysis-lengths-hint" style="display:none"></p>
            </div>
            <div class="section-group">
                <label>고유치 수</label>
                <p class="hint">각 반파장에서 계산할 좌굴 모드 수. 1차 모드가 가장 중요합니다.</p>
                <input type="number" id="input-neigs" value="10" step="1">
            </div>
            <div class="section-group">
                <label>cFSM 모드 분류</label>
                <p class="hint">구속 유한스트립법(cFSM)으로 각 좌굴 모드의 G(전체)/D(뒤틀림)/L(국부)/O(기타) 구성 비율을 계산합니다.</p>
                <div class="input-row">
                    <label><input type="checkbox" id="chk-cfsm-enable" checked> 활성화</label>
                    <label><input type="checkbox" id="chk-cfsm-G" checked> Global</label>
                    <label><input type="checkbox" id="chk-cfsm-D" checked> Distortional</label>
                    <label><input type="checkbox" id="chk-cfsm-L" checked> Local</label>
                    <label><input type="checkbox" id="chk-cfsm-O" checked> Other</label>
                </div>
                <p class="hint" id="cfsm-model-note" style="display:none;margin-top:4px"></p>
                <p class="hint" style="margin-top:4px">활성화 체크 시: 해석 완료 후 Mode Classification 그래프에 G/D/L/O 비율이 표시됩니다. 체크 해제 시: 분류 없이 좌굴 곡선과 모드형상만 계산됩니다. 분류에 추가 계산 시간이 소요됩니다.</p>
            </div>
            <div class="button-row">
                <button id="btn-run-analysis" class="btn-primary">해석 실행</button>
                <button id="btn-view-buckling-report" class="btn-secondary" style="margin-left:8px">좌굴해석 결과 보고서</button>
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

        <!-- ── B. 좌굴해석 결과 (구 후처리 탭 통합) ── -->
        <h3 class="collapsible" id="sec-fsm-res" data-expanded="false" style="margin-bottom:6px"><span class="collapse-icon">▸</span> B. 좌굴해석 결과 (DSM 설계값·좌굴곡선·모드형상)</h3>
        <div id="sec-fsm-res-body" style="display:none">
            <!-- DSM 설계값 테이블 -->
            <div id="dsm-results" class="section-group" style="margin-bottom:12px">
                <h3>DSM 설계값 (DSM Design Values)</h3>
                <p class="hint">직접강도법(DSM) 설계값. Pcrl/Mcrl = 국부좌굴, Pcrd/Mcrd = 뒤틀림좌굴, Pcre/Mcre = 전체좌굴 임계하중.</p>
                <div id="dsm-table-container" class="props-display" style="font-size:13px;">
                    <em>해석을 실행하면 결과가 표시됩니다</em>
                </div>
                <!-- 해석 경고(항 부족 · 폐기 길이 · 종방향 항 선택) — 해석이 성공해도 보인다 -->
                <div id="analysis-warnings" class="validation-box" style="display:none; margin-top:6px; font-size:12px"></div>
            </div>
            <div class="panel-row">
                <div class="panel-left">
                    <h3>좌굴 곡선 (Signature Curve)</h3>
                    <p class="hint">반파장(x축) 대비 하중계수(y축) 곡선. 극소점이 좌굴 임계값을 나타냅니다. 마우스를 올리면 십자 커서와 좌표가 표시됩니다.</p>
                    <canvas id="buckling-curve-canvas" width="700" height="400" role="img" aria-label="좌굴 곡선: 반파장 대비 하중계수. 극소점이 Mcrl/Mcrd 임계값"></canvas>
                    <h3>모드 분류 (G/D/L/O) <button id="btn-run-classify" class="btn-small" style="margin-left:8px">모드 분류 실행</button></h3>
                    <p class="hint">cFSM 기반 모드 분류. 각 반파장에서 1차 좌굴 모드의 전체(G)/뒤틀림(D)/국부(L)/기타(O) 구성비를 누적 영역으로 표시합니다. 해석 실행 후 버튼을 눌러 분류를 실행하세요.</p>
                    <canvas id="classify-curve-canvas" width="700" height="200" role="img" aria-label="모드 분류: 반파장별 전체/뒤틀림/국부/기타 구성비"></canvas>
                    <p class="hint" id="classify-status" style="margin:2px 0 8px"></p>
                    <h3>소성 상호작용 곡면 (P-M Surface)</h3>
                    <p class="hint">주축(principal axis) 좌표계 기준 P-M 소성 상호작용 다이어그램. 항복값으로 정규화된 축력-모멘트 조합을 표시합니다.</p>
                    <div class="input-row" style="margin-bottom:6px">
                        <label>fy<span class="hint-inline" data-unit="stress">MPa</span></label><input type="number" id="plastic-fy" value="${steelFy}" step="5" style="width:60px">
                        <button id="btn-run-plastic" class="btn-small">곡면 생성</button>
                    </div>
                    <canvas id="plastic-surface-canvas" width="700" height="420" role="img" aria-label="소성 상호작용 곡면: 축력-모멘트 조합"></canvas>
                    <h3>자유 진동 해석 <button id="btn-run-vibration" class="btn-small" style="margin-left:8px">진동 해석 실행</button></h3>
                    <p class="hint">자유 진동 고유진동수(Hz). 단면 모델 기준으로 산정됩니다. 질량밀도를 비우면 엔진의 강재 값(7.345e-7 kip·s²/in⁴ = 7850 kg/m³)을 쓰고 경고를 남깁니다.</p>
                    <div class="input-row" style="margin-bottom:6px">
                        <label>질량밀도 ρ<span class="hint-inline" data-unit="density">kg/m³</span></label><input type="number" id="vib-rho" value="" placeholder="강재 기본" step="any" style="width:110px">
                        <label>진동 길이<span class="hint-inline" data-unit="length">mm</span></label><input type="text" id="vib-lengths" value="" placeholder="비우면 좌굴 해석 길이" style="width:150px" title="부재 길이 몇 개를 쉼표로. 비우면 좌굴 해석의 길이 · 종방향 항을 씀">
                    </div>
                    <div id="vibration-result" class="props-display" style="font-size:12px;"><em>진동 해석을 실행하면 결과가 표시됩니다</em></div>
                </div>
                <div class="panel-right">
                    <h3>모드 형상 (2D)</h3>
                    <p class="hint">선택한 반파장/모드에서의 단면 변형 형상. 주황색 = 변형, 회색 = 미변형. Length 드롭다운에서 반파장을 선택하세요.</p>
                    <div id="mode-shape-container">
                        <div class="input-row">
                            <label>Length</label>
                            <select id="select-length"></select>
                            <label>Mode</label>
                            <select id="select-mode"></select>
                        </div>
                        <canvas id="mode-shape-canvas" width="600" height="340" role="img" aria-label="모드 형상 2D: 단면 변형 형상"></canvas>
                    </div>
                    <h3>모드 형상 (3D)</h3>
                    <p class="hint">좌굴 변형의 3D 시각화. Length 값이 바뀌면 해당 반파장에서의 좌굴 모드가 달라집니다 — 짧은 Length(~1~10in)는 국부좌굴(웹/플랜지 파형), 중간 Length(~15~40in)는 뒤틀림좌굴(립-플랜지 회전), 긴 Length(~100in+)는 전체좌굴(횡비틀림)을 보여줍니다. 마우스 드래그=회전, 스크롤=확대/축소.</p>
                    <canvas id="mode-shape-3d-canvas" width="600" height="400" role="img" aria-label="모드 형상 3D: 좌굴 변형 시각화"></canvas>
                </div>
            </div>
        </div>

        <!-- ── C. 부재 설계 ── -->
        <h3 class="collapsible" id="sec-member-design" data-expanded="true" style="margin-bottom:6px"><span class="collapse-icon">▾</span> C. 부재 설계 (AISI S100-16 DSM)</h3>
        <div id="sec-member-design-body">
        <div class="panel-row">
            <div class="panel-left" style="max-width:360px">
                <h3 class="collapsible" id="sec-material" data-expanded="true"><span class="collapse-icon">▾</span> 재료 (Material) <span class="hint-inline" style="font-weight:normal">(①단면·재료 탭에서 설정 — 읽기전용)</span></h3>
                <div id="sec-material-body">
                <div class="input-row">
                    <label>Fy<span class="hint-inline" data-unit="stress">MPa</span></label>
                    <input type="number" id="design-fy" value="${steelFy}" style="width:68px" readonly tabindex="-1" class="input-readonly">
                    <label>Fu<span class="hint-inline" data-unit="stress">MPa</span></label>
                    <input type="number" id="design-fu" value="${steelFu}" style="width:68px" readonly tabindex="-1" class="input-readonly">
                </div>
                </div>

                <h3 class="collapsible" id="sec-method" data-expanded="true"><span class="collapse-icon">▾</span> 설계 방법</h3>
                <div id="sec-method-body">
                <div class="input-row">
                    <select id="select-design-method" style="width:130px">
                        <option value="LRFD">LRFD (φRn≥Ru)</option>
                        <option value="ASD">ASD (Rn/Ω≥Ra)</option>
                    </select>
                    <span class="hint-inline" style="font-size:11px">해석법: DSM (직접강도법, Appendix 2)</span>
                </div>
                </div>

                <p id="design-membertype-echo" class="hint" style="margin:2px 0 8px"></p>

                <h3 id="design-lengths-title">좌굴 길이 (유효좌굴 K·L / 비지지 Lb)</h3>
                <div class="input-row" id="design-KxLx-row">
                    <label>KxLx<span class="hint-inline" data-unit="length">mm</span></label>
                    <input type="number" id="design-KxLx" value="3000" step="100" style="width:65px">
                    <label>KyLy<span class="hint-inline" data-unit="length">mm</span></label>
                    <input type="number" id="design-KyLy" value="3000" step="100" style="width:65px">
                </div>
                <div class="input-row" id="design-KtLt-row">
                    <label>KtLt<span class="hint-inline" data-unit="length">mm</span></label>
                    <input type="number" id="design-KtLt" value="3000" step="100" style="width:65px">
                </div>
                <p class="hint" style="margin:6px 0 2px;font-weight:600">정모멘트 구간 (+M)</p>
                <div class="input-row" id="design-Cb-pos-row">
                    <label>Cb(+)</label>
                    <input type="number" id="design-Cb-pos" value="1.0" step="0.01" style="width:65px">
                    <span id="design-Cb-pos-calc" style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px"></span>
                </div>
                <div class="input-row" id="design-Lb-pos-row">
                    <label>Lb(+)<span class="hint-inline" data-unit="length">mm</span></label>
                    <input type="number" id="design-Lb-pos" value="0" step="100" style="width:65px">
                    <span id="design-Lb-pos-calc" style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px">데크 구속 시 0</span>
                </div>
                <p class="hint" style="margin:6px 0 2px;font-weight:600">부모멘트 구간 (-M)</p>
                <div class="input-row" id="design-Cb-row">
                    <label>Cb(-)</label>
                    <input type="number" id="design-Cb" value="1.0" step="0.01" style="width:65px">
                    <span id="design-Cb-calc" style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px"></span>
                </div>
                <div class="input-row" id="design-Lb-row">
                    <label>Lb(-)<span class="hint-inline" data-unit="length">mm</span></label>
                    <input type="number" id="design-Lb" value="3000" step="100" style="width:65px">
                    <span id="design-Lb-calc" style="font-size:10px;color:var(--vscode-descriptionForeground);margin-left:4px"></span>
                </div>

                <h3 style="margin-top:10px">§2.3.3.3 뒤틀림 모멘트구배 (β)</h3>
                <p class="hint">부모멘트 구간 등 비균일 모멘트 분포 시 Mcrd를 β배 증가시킵니다. 균일 모멘트는 β=1.0.</p>
                <div class="input-row" id="design-beta-row">
                    <label><input type="checkbox" id="chk-beta-dist" checked> β 보정 적용</label>
                </div>
                <div id="design-beta-inputs">
                    <div class="input-row">
                        <label>M1/M2</label>
                        <input type="number" id="design-dist-M1M2" value="0" step="0.1" style="width:60px" title="양: 역곡률, 음: 단일곡률, 0: 한쪽 0모멘트">
                        <label>Lm<span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-dist-Lm" value="0" step="100" style="width:60px" title="뒤틀림좌굴 구속점 간격">
                    </div>
                    <div id="design-beta-result" style="font-size:11px;color:var(--vscode-descriptionForeground);padding:4px 0"></div>
                </div>
                <div class="input-row" id="design-Cm-row" style="display:none">
                    <label>Cmx</label>
                    <input type="number" id="design-Cmx" value="1.00" step="0.01" style="width:68px">
                    <label>Cmy</label>
                    <input type="number" id="design-Cmy" value="1.00" step="0.01" style="width:68px">
                </div>

                <div id="design-wc-section" style="display:none">
                    <h3>웹 크리플링 (§G5)</h3>
                    <div class="input-row">
                        <label>N<span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-wc-N" value="89" step="1" style="width:68px">
                        <label>R<span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-wc-R" value="4.8" step="0.1" style="width:65px">
                        <label>반력 P<span class="hint-inline" data-unit="force">kN</span></label>
                        <input type="number" id="design-wc-P" value="" placeholder="미입력" step="0.1" style="width:65px" title="지점 반력(집중하중). 비우면 엔진이 대신 쓰는 값을 결과의 가정에 밝힘">
                    </div>
                    <p class="hint" style="margin:0 0 4px">N 을 비우면 웹 크리플링(§G5 · H3)을 검토하지 않습니다. 자동 계산 모드에서는 지점마다 하중 분석의 반력과 지점 형식을 씁니다.</p>
                    <div class="input-row">
                        <label>지점 조건</label>
                        <select id="design-wc-support" style="width:120px">
                            <option value="EOF">EOF (단부 1면)</option>
                            <option value="IOF">IOF (내부 1면)</option>
                            <option value="ETF">ETF (단부 2면)</option>
                            <option value="ITF">ITF (내부 2면)</option>
                        </select>
                    </div>
                    <div class="input-row">
                        <label>지지 연결</label>
                        <select id="design-wc-fastened" style="width:120px">
                            <option value="fastened">fastened</option>
                            <option value="unfastened">unfastened</option>
                        </select>
                        <label>H3 분기</label>
                        <select id="design-wc-web-config" style="width:120px">
                            <option value="single">single web</option>
                            <option value="nested_z">nested Z</option>
                            <option value="multi_web">multi-web</option>
                        </select>
                    </div>
                    <div class="input-row">
                        <label>G5 단면군</label>
                        <select id="design-wc-family" style="width:140px">
                            <option value="auto">auto from model</option>
                            <option value="built_up_i">built-up I</option>
                            <option value="C">C / channel</option>
                            <option value="Z">Z section</option>
                            <option value="hat">hat section</option>
                            <option value="multi_web">multi-web deck</option>
                        </select>
                        <label>플랜지 조건</label>
                        <select id="design-wc-flange-condition" style="width:130px">
                            <option value="stiffened">stiffened</option>
                            <option value="unstiffened">unstiffened</option>
                        </select>
                    </div>
                    <div class="input-row">
                        <label>L<sub>o</sub><span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-wc-Lo" value="0" step="1" style="width:68px">
                        <label>e<sub>ITF</sub><span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-wc-edge-distance" value="0" step="1" style="width:68px">
                        <label>n<sub>web</sub></label>
                        <input type="number" id="design-wc-nwebs" value="1" step="1" style="width:65px">
                        <label>s<sub>f</sub><span class="hint-inline" data-unit="length">mm</span></label>
                        <input type="number" id="design-wc-fastener-spacing" value="0" step="1" style="width:65px">
                    </div>
                    <p class="hint" style="font-size:10px;margin-top:4px">
                        Lo ≤ 1.5h 인 EOF C/Z만 G5-2 overhang으로 계산합니다. eITF는 C/Z의 ITF에서 끝단 연장거리(≥1.5h/2.5h) 검증에 사용합니다. hat/multi-web은 per-web 강도를 nweb로 합산합니다.
                    </p>
                </div>

                <div class="section-group" style="margin-top:10px; padding:6px 8px; border:1px solid var(--vscode-panel-border); border-radius:3px;">
                    <label style="font-size:12px; font-weight:600;">고급 옵션</label>
                    <div class="input-row" style="margin-top:4px">
                        <label><input type="checkbox" id="chk-inelastic-reserve"> §F2.4.2 Inelastic Reserve</label>
                        <span class="hint-inline">(Mne: My→Mp, deck braced 시)</span>
                    </div>
                    <div class="input-row" style="margin-top:4px" id="cold-work-notice">
                        <span style="font-size:11px;color:var(--vscode-descriptionForeground)">§A3.3.2 Cold Work — <span id="cold-work-status" style="font-weight:600"></span> <span class="hint-inline">(전처리 Material 탭에서 설정)</span></span>
                    </div>
                    <div class="input-row" style="margin-top:4px">
                        <label><input type="checkbox" id="chk-r-factor"> §I6.2.1 R-factor (양력)</label>
                        <select id="select-r-value" style="width:auto; font-size:11px; margin-left:4px" title="Table I6.2.1-1 — 경간 조건(simple/continuous)을 함께 보냅니다">
                            <option value="0" selected>미적용 (선택하세요)</option>
                            <option value="0.70" data-span="simple">0.70 — C/Z ≤6.5in simple</option>
                            <option value="0.65" data-span="simple">0.65 — C/Z 6.5~8.5in simple</option>
                            <option value="0.50" data-span="simple">0.50 — Z 8.5~12in simple</option>
                            <option value="0.40" data-span="simple">0.40 — C 8.5~12in simple</option>
                            <option value="0.60" data-span="continuous">0.60 — C continuous</option>
                            <option value="0.70" data-span="continuous">0.70 — Z continuous</option>
                        </select>
                    </div>
                    <p class="hint" style="margin:2px 0 0 20px">Through-fastened panel + 양력 시: Mn = R × Mnfo</p>
                </div>

                <div id="design-validation" class="validation-box" style="display:none" role="alert"></div>
                <div style="display:flex;gap:8px;margin-top:12px">
                    <button id="btn-run-design" class="btn-primary" style="flex:1">▶ 설계 검토 실행</button>
                </div>
                <p class="hint" style="margin-top:6px">"A. 좌굴해석"의 해석 실행 시 부재 유형에 맞는 설계용 좌굴값(P/Mxx)이 자동으로 준비됩니다.</p>
            </div>

            <div class="panel-right">
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
        </div><!-- /sec-member-design-body -->
    </div>

    <!-- 접합부 (Connection) 탭 -->
    <div id="tab-connection" class="tab-panel">
        <div class="panel-row">
            <!-- ━━━ 왼쪽: 입력 ━━━ -->
            <div class="panel-left" style="max-width:380px">

                <!-- ── Lap Splice ── -->
                <div class="conn-collapsible" data-expanded="true" style="cursor:pointer;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)">
                    <span class="conn-collapse-icon" style="font-size:11px">▼</span> Lap Splice 접합부 <span class="hint-inline">§I6.2.1, §J3, §J4</span>
                </div>
                <div class="conn-collapse-body" style="padding:4px 0 8px 0">
                    <p class="hint" style="margin-bottom:6px">연속 경간 퍼린의 Lap 구간 패스너 개수/배치를 산정하고 용량을 검증합니다. 하중분석 실행 시 자동으로 값이 채워집니다.</p>
                    <div class="input-row"><label style="min-width:56px;text-align:right">좌측 Lap</label><input type="number" id="conn-lap-left" value="305" step="10" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">지점 좌측 겹침 길이</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">우측 Lap</label><input type="number" id="conn-lap-right" value="305" step="10" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">지점 우측 겹침 길이</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">지점 Mu</label><input type="number" id="conn-Mu" value="0" step="0.1" style="width:72px" data-unit="moment"><span class="hint-inline conn-unit-moment">지점 최대 부모멘트</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">지점 Vu</label><input type="number" id="conn-Vu" value="0" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force">지점 최대 전단력</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">패스너</label>
                        <select id="conn-fastener-type" style="font-size:12px"><option value="screw" selected>Screw</option><option value="bolt">Bolt</option></select>
                        <label>d</label><input type="number" id="conn-fastener-dia" value="4.8" step="0.1" style="width:56px" data-unit="length"><span class="hint-inline conn-unit-length">패스너 직경</span>
                    </div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">행 수</label><input type="number" id="conn-n-rows" value="2" min="1" max="4" step="1" style="width:56px"><span class="hint-inline">웹 높이 방향 패스너 열 수</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">단부거리 e</label><input type="number" id="conn-edge-dist" value="" placeholder="미입력" step="1" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">비우면 1.5d 배치 제안(판정 근거 아님). 입력값은 그대로 J3.2/J4.2 로 검토</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">Pnvs</label><input type="number" id="conn-lap-Pnvs" value="" placeholder="제조사 값" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force">나사 공칭 전단강도(§J4.3.2) — 나사 랩은 없으면 판정 없음</span></div>
                    <button id="btn-run-lap-design" class="btn-action-green" style="margin-top:8px;width:100%;padding:6px">Lap 접합부 설계</button>
                </div>

                <!-- ── 단일 접합부 ── -->
                <div class="conn-collapsible" data-expanded="true" style="cursor:pointer;padding:4px 6px;font-weight:600;border-bottom:1px solid var(--vscode-panel-border)">
                    <span class="conn-collapse-icon" style="font-size:11px">▼</span> 단일 접합부 강도 계산 <span class="hint-inline">Chapter J — 7종</span>
                </div>
                <div class="conn-collapse-body" style="padding:4px 0 8px 0">
                    <p class="hint" style="margin-bottom:6px">개별 패스너 또는 용접의 공칭강도/설계강도를 AISI Chapter J에 따라 계산합니다.</p>
                    <div class="input-row" style="margin-bottom:6px">
                        <label style="min-width:56px;text-align:right">유형</label>
                        <select id="conn-single-type" style="font-size:12px;flex:1">
                            <optgroup label="기계적 접합">
                                <option value="screw">Screw — 나사 (§J4)</option>
                                <option value="bolt">Bolt — 볼트 (§J3)</option>
                                <option value="paf">PAF — 화약고정 (§J5)</option>
                            </optgroup>
                            <optgroup label="용접 접합">
                                <option value="fillet_weld">Fillet Weld — 필릿 (§J2.5)</option>
                                <option value="arc_spot">Arc Spot — 아크점 (§J2.2)</option>
                                <option value="arc_seam">Arc Seam — 아크심 (§J2.3)</option>
                                <option value="groove">Groove — 그루브 (§J2.1/J2.6)</option>
                            </optgroup>
                        </select>
                    </div>
                    <p id="conn-single-hint" class="hint" style="margin:0 0 6px"></p>
                    <div class="input-row"><label style="min-width:56px;text-align:right">t1</label><input type="number" id="conn-t1" value="1.5" step="0.1" style="width:72px" data-unit="thickness"><label>t2</label><input type="number" id="conn-t2" value="1.5" step="0.1" style="width:72px" data-unit="thickness"><span class="hint-inline conn-unit-thickness">접합 부재 두께</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">직경 d</label><input type="number" id="conn-d" value="4.8" step="0.1" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">패스너/용접 직경</span><label>개수 n</label><input type="number" id="conn-n" value="4" min="1" step="1" style="width:56px"></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">Fy</label><input type="number" id="conn-Fy" value="${steelFy}" step="10" style="width:72px" data-unit="stress"><label>Fu</label><input type="number" id="conn-Fu" value="${steelFu}" step="10" style="width:72px" data-unit="stress"><span class="hint-inline conn-unit-stress">전처리 재료와 자동 동기화 (수정 가능)</span></div>
                    <div class="input-row" id="conn-weld-row" style="display:none"><label style="min-width:56px;text-align:right">용접길이</label><input type="number" id="conn-weld-L" value="50" step="1" style="width:72px" data-unit="length"><label>크기</label><input type="number" id="conn-weld-size" value="3" step="0.5" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">용접 유효 길이/크기</span></div>
                    <div class="input-row" id="conn-groove-row" style="display:none"><label style="min-width:56px;text-align:right">그루브</label><select id="conn-groove-type" style="font-size:12px"><option value="complete">완전용입 CJP</option><option value="partial">부분용입 PJP</option></select></div>
                    <div class="input-row" id="conn-bolt-row" style="display:none"><label style="min-width:56px;text-align:right">Fub</label><input type="number" id="conn-Fub" value="" placeholder="미입력" step="10" style="width:72px" data-unit="stress"><span id="conn-Fub-hint" class="hint-inline conn-unit-stress">볼트 인장강도 — 비우면 엔진이 최저 등급 A307 값을 쓰고 경고</span></div>
                    <div class="input-row" id="conn-screw-row" style="display:none"><label style="min-width:56px;text-align:right">Pnvs</label><input type="number" id="conn-Pnvs" value="" placeholder="제조사 값" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force">나사 공칭 전단강도(제조사·시험, §J4.3.2) — 없으면 0.5·Fub·As 는 참고값, 판정 없음</span></div>
                    <div class="input-row" id="conn-dw-row" style="display:none"><label style="min-width:56px;text-align:right">d&#39;w</label><input type="number" id="conn-dw" value="" placeholder="미입력" step="0.1" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">머리·와셔 접촉 직경 (인장 Tu 가 있을 때 §J4.4.2 풀오버)</span></div>
                    <div class="input-row" id="conn-paf-row" style="display:none"><label style="min-width:56px;text-align:right">Fuf</label><input type="number" id="conn-Fuf" value="" placeholder="제조사 값" step="10" style="width:72px" data-unit="stress"><span class="hint-inline conn-unit-stress">PAF 핀 인장강도 F<sub>uh</sub>(제조사) — 없으면 120 ksi 는 참고값, 판정 없음</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">Pu</label><input type="number" id="conn-Pu" value="0" step="0.1" style="width:72px" data-unit="force"><span class="hint-inline conn-unit-force">면내 전단 소요강도</span><label>Tu</label><input type="number" id="conn-Tu" value="" placeholder="없음" step="0.1" style="width:64px" data-unit="force"><span class="hint-inline conn-unit-force">인장(뽑힘) 소요강도</span></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">끝단 e</label><input type="number" id="conn-e" value="" placeholder="미입력" step="1" style="width:72px" data-unit="length"><span class="hint-inline conn-unit-length">하중방향 끝단거리(패스너 중심 → 재단 끝)</span><label>간격 s</label><input type="number" id="conn-s" value="" placeholder="미입력" step="1" style="width:64px" data-unit="length"></div>
                    <div class="input-row"><label style="min-width:56px;text-align:right">부재</label><select id="conn-member-case" style="font-size:12px"><option value="" selected>미입력 (J6.2 판정 없음)</option><option value="not_tension_member">인장재 아님 — J6.2 해당 없음</option><option value="flat_sheet">평판 (Table J6.2-1)</option><option value="flat_sheet_staggered">평판 엇갈림 배치</option><option value="angle_bolted">앵글 — 볼트·나사</option><option value="angle_welded">앵글 — 용접</option><option value="channel_bolted">채널 — 볼트·나사</option><option value="channel_welded">채널 — 용접</option><option value="all_elements">모든 요소 접합</option><option value="transverse_weld">횡방향 용접만</option></select><label>폭</label><input type="number" id="conn-width" value="" placeholder="미입력" step="1" style="width:64px" data-unit="length"><span class="hint-inline conn-unit-length">인장재 순단면 폭(J6.2)</span></div>
                    <div class="input-row"><label><input type="checkbox" id="conn-j63-na"> 블록전단 경로 없음 (J6.3 해당 없음)</label></div>
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
            <button id="btn-print-report" class="btn-secondary" style="width:100px;display:none">PDF 저장</button>
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

    <script nonce="${nonce}" src="${designStateUri}"></script>
    <script nonce="${nonce}" src="${utilsUri}"></script>
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
        await this._writeProjectFile(uri.fsPath, designData);
        vscode.window.showInformationMessage(`Project saved: ${uri.fsPath}`);
    }

    /**
     * .csd 조립과 쓰기(대화상자와 분리 — 시험이 직접 부른다). 웹뷰는 {designInputs, lapResult} 를 보낸다
     * (옛 웹뷰는 designInputs 만). v1.3: lapResult 추가. 옛 파일(1.0–1.2)도 읽힌다.
     */
    public async __testWriteProjectFile(fsPath: string, designData?: any): Promise<any> {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        return this._writeProjectFile(fsPath, designData);
    }

    public __testLoadProjectFile(fsPath: string): { error?: string; warnings: string[] } {
        if (!isTestMode()) {
            throw new Error('Test hooks are only available when STCFSD_TEST_MODE=1');
        }
        return this._loadProjectFile(fsPath);
    }

    private async _writeProjectFile(fsPath: string, designData?: any): Promise<any> {
        const saveSignature = this._currentModelSignature();
        const wrapped = designData && typeof designData === 'object' && designData.__stcfsd_collect === 2;
        const designInputs = wrapped ? (designData.designInputs ?? null) : (designData || null);
        const lapResult = wrapped ? (designData.lapResult ?? null) : null;

        const projectData: any = {
            version: '1.3',
            format: 'cufsm-section-design',
            timestamp: new Date().toISOString(),
            // V4-11: 결과를 만든 엔진 판 — 열 때 이 판과 다르면 결과를 버린다.
            resultsEngine: {
                results_format: StcfsdPanel.RESULTS_FORMAT,
                protocol_version: this._pythonBridge.selftest?.protocol_version ?? null,
                python: this._pythonBridge.selftest?.python ?? null,
            },
            model: this._cloneModel(this._model),
            derivedStateSignature: saveSignature,
            analysisResult: this._isAnalysisCurrent() ? this._cloneModel(this._lastAnalysisResult) : null,
            loadAnalysis: this._lastLoadAnalysis ? this._cloneModel(this._lastLoadAnalysis) : null,
            designResult: this._lastDesignResult ? this._cloneModel(this._lastDesignResult) : null,
            // Design 탭 입력값 (WebView에서 수집됨)
            designInputs,
            lapResult,
        };

        // DSM 값 추출 (있으면)
        if (this._isAnalysisCurrent() && this._model.node?.length > 0) {
            try {
                const dsm = await this._extractCurrentAnalysisDsm();
                projectData.dsm = {
                    P: dsm.P,
                    Mxx: dsm.Mxx,
                    Mzz: dsm.Mzz,
                    load_family: dsm.load_family,
                    warning: dsm.warning,
                };
            } catch (e: any) {
                projectData.dsm = { error: `DSM extraction failed at save: ${e?.message || e}` };
            }
        }
        if (this._preparedDesignDsm && this._preparedDesignDsmSig) {
            projectData.preparedDesignDsm = this._preparedDesignDsm;
        }

        // 단면 성질
        if (this._model.node?.length > 0) {
            try {
                projectData.properties = await this._pythonBridge.call('get_properties', {
                    node: this._model.node, elem: this._model.elem,
                });
            } catch { /* 성질은 열 때 웹뷰가 다시 계산한다 */ }
        }

        this._requireCurrentSignature(saveSignature, 'Project save');

        const json = JSON.stringify(projectData, null, 2);
        const tmp = `${fsPath}.tmp-${process.pid}`;
        fs.writeFileSync(tmp, json, 'utf-8');
        fs.renameSync(tmp, fsPath);
        return projectData;
    }

    /** 프로젝트 열기 (.csd 또는 MCP save_project 의 원시 모델 .stcfsd/.json) */
    private async _openProject(): Promise<void> {
        const uris = await vscode.window.showOpenDialog({
            filters: { 'StCFSD Section Design': ['csd'], 'StCFSD raw model': ['stcfsd', 'json'] },
            canSelectMany: false,
            openLabel: 'Open Project',
        });
        if (!uris || uris.length === 0) return;
        const out = this._loadProjectFile(uris[0].fsPath);
        if (out.error) {
            vscode.window.showErrorMessage(out.error);
            return;
        }
        if (out.warnings.length > 0) {
            vscode.window.showWarningMessage(`Project loaded with notes: ${out.warnings.join(' / ')}`);
        } else {
            vscode.window.showInformationMessage(`Project loaded: ${uris[0].fsPath}`);
        }
    }

    /** .csd 복원(대화상자와 분리). 실패하면 모델을 바꾸지 않는다. */
    private _loadProjectFile(fsPath: string): { error?: string; warnings: string[] } {
        const warnings: string[] = [];
        let projectData: any;
        try {
            projectData = JSON.parse(fs.readFileSync(fsPath, 'utf-8'));
        } catch (e: any) {
            return { error: `Invalid project file (${e?.message || e})`, warnings };
        }
        // MCP save_project 의 원시 모델도 연다(R8-28).
        const isWrapper = !!(projectData && typeof projectData === 'object' && projectData.model);
        if (isWrapper) {
            if (projectData.format && projectData.format !== 'cufsm-section-design') {
                return { error: `Unknown project format '${projectData.format}'`, warnings };
            }
            const major = parseInt(String(projectData.version ?? '1').split('.')[0], 10);
            if (!Number.isFinite(major) || major !== 1) {
                return { error: `Unsupported .csd version ${projectData.version} (this build reads 1.x)`, warnings };
            }
        }
        const check = this._checkLoadedModel(isWrapper ? projectData.model : projectData);
        if (check.error) {
            return { error: `Invalid project file: ${check.error}`, warnings };
        }
        warnings.push(...check.warnings);
        if (!isWrapper) { projectData = { model: projectData }; }

        // V4-01: 이전 프로젝트의 화면 결과를 먼저 모두 지운다(파일에 없는 결과가 남지 않게).
        this._lastAnalysisResult = null;
        this._lastLoadAnalysis = null;
        this._lastDesignResult = null;
        this._lastDesignRequest = null;
        this._preparedDesignDsm = null;
        this._preparedDesignDsmSig = '';
        this._postMessage('resultsCleared', { reason: 'project opened' });

        // V4-11: 결과는 그것을 만든 엔진 판의 것이다. 이 판(결과 형식 RESULTS_FORMAT, 서버 protocol_version)과
        // 다르거나 기록이 없는 옛 파일(1.0–1.2)의 결과 — 해석 · 하중 · 설계 · 준비 DSM · Lap — 는 버리고 입력만 쓴다.
        const savedEngine = isWrapper ? projectData.resultsEngine : undefined;
        const currentProtocol = this._pythonBridge.selftest?.protocol_version;
        const resultsCurrent = !!savedEngine
            && savedEngine.results_format === StcfsdPanel.RESULTS_FORMAT
            && (currentProtocol === undefined || savedEngine.protocol_version === currentProtocol);
        const hadResults = !!(projectData.analysisResult || projectData.loadAnalysis || projectData.designResult
            || projectData.preparedDesignDsm || projectData.lapResult);
        if (!resultsCurrent && hadResults) {
            warnings.push(`Results stored in this file were computed by an older engine/file version (${projectData.version ?? 'unknown'}${savedEngine ? `, protocol ${savedEngine.protocol_version}` : ''}) and were not restored — inputs were kept; run the analysis and checks again.`);
            projectData = { ...projectData, analysisResult: null, loadAnalysis: null, designResult: null,
                preparedDesignDsm: null, lapResult: null, dsm: null };
        }

        // 모델 복원. 호스트 메타데이터(템플릿 · 하중 경우 · 기준응력)는 파일의 것만 — 파일에 없으면 이전 프로젝트의
        // 값을 지니지 않는다(V4-10 재검증: v1.0 파일을 연 뒤 화면이 이전 템플릿 lippedc 를 보였다).
        const merged: any = { ...this._model, ...check.model };
        for (const k of ['sectionTemplate', 'sectionParams', 'sectionType', 'cornerRadius', 'loadCase', 'loadFy', 'loadValues']) {
            if (!(k in (check.model as any))) { delete merged[k]; }
        }
        this._model = merged;
        this._postMessage('modelLoaded', this._model);
        this._updateTreeView();

        // 해석 결과 복원 (서명이 같을 때만)
        if (projectData.analysisResult) {
            const savedSignature = projectData.analysisResult?._meta?.signature;
            if (savedSignature && savedSignature === this._currentModelSignature()) {
                this._lastAnalysisResult = projectData.analysisResult;
            } else {
                this._postMessage('analysisInvalidated', {
                    reason: 'Saved analysis is from an older or different model state. Run analysis again.',
                    invalidateLoads: false,
                });
                warnings.push('Saved buckling analysis does not match the model — run the analysis again.');
            }
        }
        this._lastLoadAnalysis = projectData.loadAnalysis || null;
        const derivedStateCurrent = projectData.derivedStateSignature === this._currentModelSignature();
        this._lastDesignResult = derivedStateCurrent ? (projectData.designResult || null) : null;
        const prepared = derivedStateCurrent ? (projectData.preparedDesignDsm || null) : null;
        // 옛 파일(설계 Fy 기록 fy_analysis 없음)의 준비 DSM 은 어떤 Fy 로 만든 것인지 몰라 쓰지 않는다.
        if (prepared && Number(prepared.fy_analysis) > 0) {
            this._preparedDesignDsm = prepared;
            this._preparedDesignDsmSig = this._currentDesignDsmSignature(Number(prepared.fy_analysis));
        } else {
            this._preparedDesignDsm = null;
            this._preparedDesignDsmSig = '';
        }

        // 입력을 먼저 복원하고(결과 라벨이 복원된 입력을 읽는다 — G2 §3.2), 그 다음 결과를 보낸다.
        // V4-10: 입력 기록이 없는 파일(v1.0 · MCP 원시 모델)도 빈 기록을 보낸다 — 화면은 모든 칸을 처음 값으로
        // 되돌린 뒤 모델의 해석 조건을 칸에 얹는다(이전 프로젝트 값이 남지 않게).
        this._postMessage('restoreDesignInputs', projectData.designInputs || {});
        if (this._lastAnalysisResult) {
            this._postMessage('analysisComplete', this._lastAnalysisResult);
            if (projectData.dsm && !projectData.dsm.error) {
                this._postMessage('dsmResult', projectData.dsm);
            }
        }
        if (projectData.loadAnalysis) {
            this._postMessage('loadAnalysisComplete', projectData.loadAnalysis);
            // 하중 결과 표시는 설계 칸을 자동으로 채운다 — 저장된 사용자 값을 다시 얹는다.
            if (projectData.designInputs) {
                this._postMessage('restoreDesignInputs', projectData.designInputs);
            }
        }
        if (this._lastDesignResult) {
            if (Array.isArray(this._lastDesignResult.regions) || this._lastDesignResult.design_positive !== undefined) {
                this._postMessage('designPurlinResult', this._lastDesignResult);
            } else {
                this._postMessage('designResult', this._lastDesignResult);
            }
        }
        if (projectData.lapResult) {
            this._postMessage('lapConnectionResult', projectData.lapResult);
        }
        if (projectData.properties) {
            this._postMessage('propertiesResult', projectData.properties);
        }
        return { warnings };
    }

    private _dispose(): void {
        StcfsdPanel.currentPanel = undefined;
        this._disposed = true;
        if (this._previewResolve) {
            this._previewResolve({ error: 'Panel disposed before capture completed.' });
            this._previewResolve = null;
        }
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
