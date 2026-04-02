/**
 * CUFSM 프로젝트 탐색기 — VS Code 사이드바 트리뷰
 *
 * 참조: 컨버전전략.md §8 package.json — viewsContainers, views
 *
 * .cufsm 프로젝트 파일을 워크스페이스에서 검색하여 트리 구조로 표시한다.
 */

import * as vscode from 'vscode';
import * as path from 'path';

export class ProjectExplorerProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private _projects: ProjectItem[] = [];

    constructor() {
        this.refresh();
    }

    refresh(): void {
        this._findProjects().then(projects => {
            this._projects = projects;
            this._onDidChangeTreeData.fire(undefined);
        });
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ProjectItem): ProjectItem[] {
        if (!element) {
            return this._projects;
        }
        return element.children || [];
    }

    private async _findProjects(): Promise<ProjectItem[]> {
        const items: ProjectItem[] = [];

        if (!vscode.workspace.workspaceFolders) {
            return items;
        }

        for (const folder of vscode.workspace.workspaceFolders) {
            const pattern = new vscode.RelativePattern(folder, '**/*.cufsm');
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 50);

            for (const file of files) {
                const name = path.basename(file.fsPath, '.cufsm');
                const item = new ProjectItem(
                    name,
                    file,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    [
                        new ProjectItem('Section', file, vscode.TreeItemCollapsibleState.None, [], 'section'),
                        new ProjectItem('Analysis', file, vscode.TreeItemCollapsibleState.None, [], 'analysis'),
                        new ProjectItem('Results', file, vscode.TreeItemCollapsibleState.None, [], 'results'),
                    ],
                    'project'
                );
                items.push(item);
            }
        }

        if (items.length === 0) {
            items.push(new ProjectItem(
                'No .cufsm projects found',
                undefined,
                vscode.TreeItemCollapsibleState.None,
                [],
                'empty'
            ));
        }

        return items;
    }
}

class ProjectItem extends vscode.TreeItem {
    children: ProjectItem[];
    fileUri?: vscode.Uri;

    constructor(
        label: string,
        fileUri: vscode.Uri | undefined,
        collapsibleState: vscode.TreeItemCollapsibleState,
        children: ProjectItem[] = [],
        contextValue: string = ''
    ) {
        super(label, collapsibleState);
        this.children = children;
        this.fileUri = fileUri;
        this.contextValue = contextValue;

        if (contextValue === 'project') {
            this.iconPath = new vscode.ThemeIcon('file-code');
            this.tooltip = fileUri?.fsPath;
            this.command = {
                command: 'cufsm.openProject',
                title: 'Open Project',
                arguments: [fileUri],
            };
        } else if (contextValue === 'section') {
            this.iconPath = new vscode.ThemeIcon('symbol-structure');
        } else if (contextValue === 'analysis') {
            this.iconPath = new vscode.ThemeIcon('beaker');
        } else if (contextValue === 'results') {
            this.iconPath = new vscode.ThemeIcon('graph');
        } else if (contextValue === 'empty') {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}
