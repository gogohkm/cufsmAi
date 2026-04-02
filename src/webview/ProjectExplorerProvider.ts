/**
 * CUFSM 프로젝트 탐색기 — VS Code 사이드바 트리뷰
 *
 * epvscode ProjectExplorerProvider 패턴 따름:
 * - CufsmTreeItem: sectionId를 가진 트리 항목
 * - 트리 클릭 → CufsmPanel.showSection(sectionId) 호출
 * - 프로젝트 데이터 변경 시 트리 자동 갱신
 */

import * as vscode from 'vscode';

export class CufsmTreeItem extends vscode.TreeItem {
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
    name: string;
    nnodes: number;
    nelems: number;
    BC: string;
    nlengths: number;
    hasResults: boolean;
}

export class ProjectExplorerProvider implements vscode.TreeDataProvider<CufsmTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CufsmTreeItem | undefined | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _summary: ProjectSummary | null = null;

    updateProjectData(summary: ProjectSummary | null): void {
        this._summary = summary;
        this._onDidChangeTreeData.fire(undefined);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CufsmTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CufsmTreeItem): CufsmTreeItem[] {
        if (!element) {
            return this._getRootItems();
        }
        return this._getChildItems(element);
    }

    private _getRootItems(): CufsmTreeItem[] {
        const items: CufsmTreeItem[] = [];

        if (!this._summary) {
            items.push(new CufsmTreeItem(
                'No section loaded',
                vscode.TreeItemCollapsibleState.None,
                {
                    description: 'Click to open designer',
                    iconPath: new vscode.ThemeIcon('info'),
                    sectionId: 'open-designer',
                }
            ));
            return items;
        }

        // 전처리 섹션
        items.push(new CufsmTreeItem(
            'Preprocessor',
            vscode.TreeItemCollapsibleState.Expanded,
            {
                sectionId: 'preprocessor',
                iconPath: new vscode.ThemeIcon('symbol-structure'),
                contextValue: 'section-preprocessor',
            }
        ));

        // 해석 섹션
        items.push(new CufsmTreeItem(
            'Analysis',
            vscode.TreeItemCollapsibleState.Expanded,
            {
                sectionId: 'analysis',
                iconPath: new vscode.ThemeIcon('beaker'),
                contextValue: 'section-analysis',
            }
        ));

        // 후처리 섹션
        items.push(new CufsmTreeItem(
            'Postprocessor',
            vscode.TreeItemCollapsibleState.Expanded,
            {
                sectionId: 'postprocessor',
                description: this._summary.hasResults ? 'Results available' : '',
                iconPath: new vscode.ThemeIcon('graph'),
                contextValue: 'section-postprocessor',
            }
        ));

        return items;
    }

    private _getChildItems(parent: CufsmTreeItem): CufsmTreeItem[] {
        const items: CufsmTreeItem[] = [];
        const s = this._summary;

        switch (parent.sectionId) {
            case 'preprocessor':
                items.push(new CufsmTreeItem('Section Template', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'template',
                    iconPath: new vscode.ThemeIcon('symbol-class'),
                    description: s ? `${s.nnodes} nodes, ${s.nelems} elems` : '',
                }));
                items.push(new CufsmTreeItem('Material Properties', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'material',
                    iconPath: new vscode.ThemeIcon('symbol-property'),
                }));
                items.push(new CufsmTreeItem('Node / Element Editor', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'node-elem',
                    iconPath: new vscode.ThemeIcon('table'),
                }));
                items.push(new CufsmTreeItem('Section Preview', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'section-preview',
                    iconPath: new vscode.ThemeIcon('eye'),
                }));
                break;

            case 'analysis':
                items.push(new CufsmTreeItem('Boundary Condition', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'boundary-condition',
                    iconPath: new vscode.ThemeIcon('lock'),
                    description: s?.BC || 'S-S',
                }));
                items.push(new CufsmTreeItem('Lengths', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'lengths',
                    iconPath: new vscode.ThemeIcon('symbol-ruler'),
                    description: s ? `${s.nlengths} points` : '',
                }));
                items.push(new CufsmTreeItem('cFSM Settings', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'cfsm-settings',
                    iconPath: new vscode.ThemeIcon('settings-gear'),
                }));
                items.push(new CufsmTreeItem('Run Analysis', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'run-analysis',
                    iconPath: new vscode.ThemeIcon('play'),
                    contextValue: 'section-analysis',
                }));
                break;

            case 'postprocessor':
                items.push(new CufsmTreeItem('Buckling Curve', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'buckling-curve',
                    iconPath: new vscode.ThemeIcon('graph-line'),
                }));
                items.push(new CufsmTreeItem('Mode Shape 2D', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'mode-shape-2d',
                    iconPath: new vscode.ThemeIcon('symbol-misc'),
                }));
                items.push(new CufsmTreeItem('Mode Shape 3D', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'mode-shape-3d',
                    iconPath: new vscode.ThemeIcon('preview'),
                }));
                items.push(new CufsmTreeItem('Mode Classification', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'classification',
                    iconPath: new vscode.ThemeIcon('list-tree'),
                }));
                items.push(new CufsmTreeItem('Plastic Surface', vscode.TreeItemCollapsibleState.None, {
                    sectionId: 'plastic-surface',
                    iconPath: new vscode.ThemeIcon('circle-outline'),
                }));
                break;
        }

        return items;
    }
}
