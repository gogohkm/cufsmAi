/**
 * CUFSM 프로젝트 탐색기 — VS Code 사이드바 트리뷰 (v2)
 *
 * 6개 탭(전처리·해석·후처리·설계·보고서·검증)의 주요 입력/결과를
 * 트리 항목으로 표시하고, 클릭 시 해당 입력칸으로 포커스 이동.
 */

import * as vscode from 'vscode';

export class StcfsdTreeItem extends vscode.TreeItem {
    public sectionId?: string;

    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        options?: {
            sectionId?: string;
            description?: string;
            tooltip?: string;
            iconPath?: vscode.ThemeIcon;
            contextValue?: string;
        }
    ) {
        super(label, collapsibleState);
        if (options) {
            this.sectionId = options.sectionId;
            this.description = options.description;
            this.tooltip = options.tooltip;
            this.iconPath = options.iconPath;
            this.contextValue = options.contextValue;
        }
    }
}

export interface ProjectSummary {
    // 전처리
    name: string;
    nnodes: number;
    nelems: number;
    sectionType: string;
    H: string; B: string; D: string; t: string;
    // 재료
    steelGrade: string;
    Fy: string; Fu: string;
    // 해석
    BC: string;
    nlengths: number;
    hasResults: boolean;
    // 단면 성질
    A: string; Ixx: string; Sx: string;
    rx: string; rz: string;
    // DSM 값
    Pcrl: string; Pcrd: string;
    Mcrl: string; Mcrd: string;
    // 설계
    memberType: string;
    spanType: string;
    designMethod: string;
    spanLength: string;
    spacing: string;
    // 하중
    loadD: string; loadLr: string; loadS: string; loadW: string; loadL: string;
    // 설계 결과
    hasDesignResult: boolean;
    designMn: string;
    designPn: string;
    controllingMode: string;
    utilization: string;
    passOrFail: string;
    // 하중 분석
    hasLoadAnalysis: boolean;
    gravityCombo: string;
    maxMu: string;
    maxVu: string;
    // 처짐
    maxDeflection: string;
    deflectionRatio: string;
    // 검증
    validationPass: number;
    validationWarn: number;
    validationFail: number;
}

const EMPTY: ProjectSummary = {
    name: '', nnodes: 0, nelems: 0, sectionType: '',
    H: '', B: '', D: '', t: '',
    steelGrade: '', Fy: '', Fu: '',
    BC: 'S-S', nlengths: 0, hasResults: false,
    A: '', Ixx: '', Sx: '', rx: '', rz: '',
    Pcrl: '', Pcrd: '', Mcrl: '', Mcrd: '',
    memberType: '', spanType: '', designMethod: 'LRFD',
    spanLength: '', spacing: '',
    loadD: '', loadLr: '', loadS: '', loadW: '', loadL: '',
    hasDesignResult: false,
    designMn: '', designPn: '', controllingMode: '', utilization: '', passOrFail: '',
    hasLoadAnalysis: false, gravityCombo: '', maxMu: '', maxVu: '',
    maxDeflection: '', deflectionRatio: '',
    validationPass: 0, validationWarn: 0, validationFail: 0,
};

export class ProjectExplorerProvider implements vscode.TreeDataProvider<StcfsdTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StcfsdTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _summary: ProjectSummary | null = null;

    updateProjectData(summary: Partial<ProjectSummary> | null): void {
        if (summary) {
            this._summary = { ...EMPTY, ...(this._summary || {}), ...summary };
        } else {
            this._summary = null;
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: StcfsdTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: StcfsdTreeItem): StcfsdTreeItem[] {
        if (!element) { return this._getRootItems(); }
        return this._getChildItems(element);
    }

    // ─── 루트 (6개 탭) ───
    private _getRootItems(): StcfsdTreeItem[] {
        if (!this._summary) {
            return [new StcfsdTreeItem('단면 미로드', vscode.TreeItemCollapsibleState.None, {
                description: '클릭하여 디자이너 열기',
                iconPath: new vscode.ThemeIcon('info'),
                sectionId: 'open-designer',
            })];
        }
        const s = this._summary;
        return [
            new StcfsdTreeItem('전처리', vscode.TreeItemCollapsibleState.Expanded, {
                sectionId: 'preprocessor',
                iconPath: new vscode.ThemeIcon('symbol-structure'),
                description: s.nnodes > 0 ? `${s.sectionType || ''} ${s.nnodes}절점` : '',
            }),
            new StcfsdTreeItem('해석', vscode.TreeItemCollapsibleState.Collapsed, {
                sectionId: 'analysis',
                iconPath: new vscode.ThemeIcon('beaker'),
                description: s.hasResults ? '결과 있음' : '',
                contextValue: 'section-analysis',
            }),
            new StcfsdTreeItem('후처리', vscode.TreeItemCollapsibleState.Collapsed, {
                sectionId: 'postprocessor',
                iconPath: new vscode.ThemeIcon('graph'),
                description: s.hasResults ? 'DSM 추출' : '',
            }),
            new StcfsdTreeItem('설계', vscode.TreeItemCollapsibleState.Expanded, {
                sectionId: 'design',
                iconPath: new vscode.ThemeIcon('tools'),
                description: s.hasDesignResult ? s.passOrFail : '',
            }),
            new StcfsdTreeItem('보고서', vscode.TreeItemCollapsibleState.None, {
                sectionId: 'report',
                iconPath: new vscode.ThemeIcon('file-text'),
            }),
            new StcfsdTreeItem('검증', vscode.TreeItemCollapsibleState.Collapsed, {
                sectionId: 'validation',
                iconPath: new vscode.ThemeIcon('checklist'),
                description: (s.validationPass + s.validationWarn + s.validationFail) > 0
                    ? `${s.validationPass}통과 ${s.validationWarn}주의 ${s.validationFail}실패`
                    : '',
            }),
        ];
    }

    // ─── 하위 항목 ───
    private _getChildItems(parent: StcfsdTreeItem): StcfsdTreeItem[] {
        const items: StcfsdTreeItem[] = [];
        const s = this._summary || EMPTY;

        switch (parent.sectionId) {

        // ━━━ 전처리 ━━━
        case 'preprocessor':
            items.push(this._leaf('단면 템플릿', 'focus-template',
                'symbol-class', s.sectionType || '미설정'));
            if (s.H) items.push(this._leaf('치수', 'focus-tpl-H',
                'symbol-ruler', `H=${s.H} B=${s.B} t=${s.t}`));
            items.push(this._leaf('재료', 'focus-design-fy',
                'symbol-property', s.steelGrade ? `${s.steelGrade} Fy=${s.Fy}` : ''));
            items.push(this._leaf('절점/요소', 'node-elem',
                'table', `${s.nnodes}절점 ${s.nelems}요소`));
            if (s.A) items.push(this._leaf('단면 성질', 'focus-props',
                'symbol-numeric', `A=${s.A} Ixx=${s.Ixx}`));
            break;

        // ━━━ 해석 ━━━
        case 'analysis':
            items.push(this._leaf('경계조건', 'boundary-condition',
                'lock', s.BC));
            items.push(this._leaf('반파장', 'lengths',
                'symbol-ruler', `${s.nlengths}점`));
            items.push(this._leaf('cFSM 설정', 'cfsm-settings',
                'settings-gear', ''));
            items.push(new StcfsdTreeItem('해석 실행', vscode.TreeItemCollapsibleState.None, {
                sectionId: 'run-analysis',
                iconPath: new vscode.ThemeIcon('play'),
                contextValue: 'section-analysis',
            }));
            break;

        // ━━━ 후처리 ━━━
        case 'postprocessor':
            items.push(this._leaf('좌굴 곡선', 'buckling-curve', 'graph-line', ''));
            items.push(this._leaf('모드 형상 2D', 'mode-shape-2d', 'symbol-misc', ''));
            items.push(this._leaf('모드 형상 3D', 'mode-shape-3d', 'preview', ''));
            items.push(this._leaf('모드 분류', 'classification', 'list-tree', ''));
            if (s.Pcrl || s.Mcrl) {
                items.push(this._leaf('DSM 압축', 'focus-dsm-P',
                    'arrow-down', `Pcrl=${s.Pcrl} Pcrd=${s.Pcrd}`));
                items.push(this._leaf('DSM 휨', 'focus-dsm-M',
                    'arrow-right', `Mcrl=${s.Mcrl} Mcrd=${s.Mcrd}`));
            }
            break;

        // ━━━ 설계 ━━━
        case 'design':
            // 입력
            items.push(this._leaf('부재 유형', 'focus-member-type',
                'symbol-interface', s.memberType || '미설정'));
            items.push(this._leaf('스팬 구성', 'focus-span-type',
                'split-horizontal', s.spanType ? `${s.spanType} ${s.spanLength}` : ''));
            items.push(this._leaf('간격', 'focus-spacing',
                'move', s.spacing || ''));
            // 하중
            items.push(new StcfsdTreeItem('하중', vscode.TreeItemCollapsibleState.Collapsed, {
                sectionId: 'design-loads',
                iconPath: new vscode.ThemeIcon('cloud-download'),
                description: s.loadD ? `D=${s.loadD}` : '',
            }));
            // 비지지 길이
            items.push(this._leaf('비지지 길이', 'focus-design-Lb',
                'symbol-ruler', ''));
            // 하중 분석 결과
            if (s.hasLoadAnalysis) {
                items.push(new StcfsdTreeItem('하중 분석 결과', vscode.TreeItemCollapsibleState.Collapsed, {
                    sectionId: 'design-load-results',
                    iconPath: new vscode.ThemeIcon('pulse'),
                    description: s.gravityCombo || '',
                }));
            }
            // 설계 결과
            if (s.hasDesignResult) {
                items.push(new StcfsdTreeItem('설계 결과', vscode.TreeItemCollapsibleState.Collapsed, {
                    sectionId: 'design-results',
                    iconPath: new vscode.ThemeIcon(s.passOrFail === 'OK' ? 'pass' : 'error'),
                    description: `${s.utilization} ${s.passOrFail}`,
                }));
            }
            break;

        // ━━━ 설계 > 하중 ━━━
        case 'design-loads':
            if (s.loadD)  items.push(this._leaf('고정 D', 'focus-load-D', 'dash', s.loadD));
            if (s.loadLr) items.push(this._leaf('지붕활 Lr', 'focus-load-Lr', 'dash', s.loadLr));
            if (s.loadS)  items.push(this._leaf('적설 S', 'focus-load-S', 'dash', s.loadS));
            if (s.loadL)  items.push(this._leaf('활 L', 'focus-load-L', 'dash', s.loadL));
            if (s.loadW)  items.push(this._leaf('풍 W', 'focus-load-W', 'dash', s.loadW));
            break;

        // ━━━ 설계 > 하중 분석 결과 ━━━
        case 'design-load-results':
            items.push(this._leaf('지배 조합', 'focus-gravity-combo',
                'star-full', s.gravityCombo));
            items.push(this._leaf('최대 Mu', 'focus-max-Mu',
                'arrow-both', s.maxMu));
            items.push(this._leaf('최대 Vu', 'focus-max-Vu',
                'arrow-swap', s.maxVu));
            if (s.maxDeflection) {
                items.push(this._leaf('최대 처짐', 'focus-deflection',
                    'fold-down', `${s.maxDeflection} (L/${s.deflectionRatio})`));
            }
            break;

        // ━━━ 설계 > 설계 결과 ━━━
        case 'design-results':
            items.push(this._leaf('지배 모드', 'focus-controlling-mode',
                'warning', s.controllingMode));
            if (s.designMn) items.push(this._leaf('φMn', 'focus-design-Mn',
                'arrow-right', s.designMn));
            if (s.designPn) items.push(this._leaf('φPn', 'focus-design-Pn',
                'arrow-down', s.designPn));
            items.push(this._leaf('이용률 DCR', 'focus-utilization',
                s.passOrFail === 'OK' ? 'pass' : 'error', s.utilization));
            break;

        // ━━━ 검증 ━━━
        case 'validation':
            if (s.validationFail > 0)
                items.push(this._leaf('실패 항목', 'focus-validation-fail',
                    'error', `${s.validationFail}개`));
            if (s.validationWarn > 0)
                items.push(this._leaf('주의 항목', 'focus-validation-warn',
                    'warning', `${s.validationWarn}개`));
            items.push(this._leaf('통과 항목', 'focus-validation-pass',
                'pass', `${s.validationPass}개`));
            items.push(new StcfsdTreeItem('검증 실행', vscode.TreeItemCollapsibleState.None, {
                sectionId: 'run-validation',
                iconPath: new vscode.ThemeIcon('play'),
            }));
            break;
        }

        return items;
    }

    // ─── 리프 노드 헬퍼 ───
    private _leaf(label: string, sectionId: string,
                  icon: string, desc: string): StcfsdTreeItem {
        return new StcfsdTreeItem(label, vscode.TreeItemCollapsibleState.None, {
            sectionId,
            iconPath: new vscode.ThemeIcon(icon),
            description: desc,
        });
    }
}
