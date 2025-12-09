import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { Change, SourceSelection, Status } from '../git/types';

export enum TreeItemType {
  Source = 'source',
  Target = 'target',
  Separator = 'separator',
  Folder = 'folder',
  File = 'file',
  Conflict = 'conflict',
  Info = 'info',
}

interface FolderNode {
  name: string;
  path: string;
  children: Map<string, FolderNode>;
  files: Change[];
}

export class BranchTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: TreeItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly folderPath?: string,
    public readonly change?: Change
  ) {
    super(label, collapsibleState);

    this.contextValue = itemType;
    this.setupIcon();
    this.setupCommand();
  }

  private setupIcon(): void {
    switch (this.itemType) {
      case TreeItemType.Source:
        this.iconPath = new vscode.ThemeIcon('git-commit');
        break;
      case TreeItemType.Target:
        this.iconPath = new vscode.ThemeIcon('git-compare');
        break;
      case TreeItemType.Separator:
        // No icon for separator
        break;
      case TreeItemType.Folder:
        // Don't set iconPath - let resourceUri handle folder icon
        break;
      case TreeItemType.File:
        // Don't set iconPath - let resourceUri handle file icon based on extension
        this.setupFileDecoration();
        break;
      case TreeItemType.Conflict:
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
        break;
      case TreeItemType.Info:
        this.iconPath = new vscode.ThemeIcon('info');
        break;
    }
  }

  private setupFileDecoration(): void {
    if (!this.change) {
      return;
    }

    switch (this.change.status) {
      case Status.INDEX_ADDED:
      case Status.UNTRACKED:
        this.description = 'A';
        break;
      case Status.INDEX_DELETED:
      case Status.DELETED:
        this.description = 'D';
        break;
      case Status.INDEX_MODIFIED:
      case Status.MODIFIED:
        this.description = 'M';
        break;
      case Status.INDEX_RENAMED:
        this.description = 'R';
        break;
    }
  }

  private setupCommand(): void {
    if (this.itemType === TreeItemType.Source) {
      this.command = {
        command: 'branch-diff.changeSource',
        title: 'Change Source',
      };
    } else if (this.itemType === TreeItemType.Target) {
      this.command = {
        command: 'branch-diff.changeTarget',
        title: 'Change Target',
      };
    }
  }
}

export interface DiffResult {
  changes: Change[];
  hasConflict: boolean;
  error?: string;
}

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _source: SourceSelection = { type: 'workingTree' };
  private _target: string | undefined;
  private _diffResult: DiffResult | undefined;
  private _folderTree: FolderNode | undefined;

  constructor(private gitService: GitService) {}

  get source(): SourceSelection {
    return this._source;
  }

  get target(): string | undefined {
    return this._target;
  }

  setSource(source: SourceSelection): void {
    this._source = source;
    this._diffResult = undefined;
    this._folderTree = undefined;
    this.refresh();
  }

  setTarget(target: string): void {
    this._target = target;
    this._diffResult = undefined;
    this._folderTree = undefined;
    this.refresh();
  }

  refresh(): void {
    this._diffResult = undefined;
    this._folderTree = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!this.gitService.getRepository()) {
      return [
        new BranchTreeItem(
          'No Git repository found',
          TreeItemType.Info,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    if (!element) {
      return this.getRootItems();
    }

    // Handle folder expansion
    if (element.itemType === TreeItemType.Folder && element.folderPath) {
      return this.getFolderChildren(element.folderPath);
    }

    return [];
  }

  private async getRootItems(): Promise<BranchTreeItem[]> {
    const items: BranchTreeItem[] = [];
    const sourceLabel = this.getSourceLabel();
    const targetLabel = this._target || '(click to select)';

    // Source item
    items.push(
      new BranchTreeItem(
        `Source: ${sourceLabel}`,
        TreeItemType.Source,
        vscode.TreeItemCollapsibleState.None
      )
    );

    // Target item
    items.push(
      new BranchTreeItem(
        `Target: ${targetLabel}`,
        TreeItemType.Target,
        vscode.TreeItemCollapsibleState.None
      )
    );

    // If no target selected, return just source and target
    if (!this._target) {
      return items;
    }

    // Add separator line
    const separator = new BranchTreeItem(
      '─────────────────',
      TreeItemType.Separator,
      vscode.TreeItemCollapsibleState.None
    );
    items.push(separator);

    // Get diff result
    if (!this._diffResult) {
      this._diffResult = await this.gitService.getDiffWithConflictDetection(this._source, this._target);
    }
    const diffResult = this._diffResult;

    // Show conflict warning if detected
    if (diffResult.hasConflict) {
      const conflictItem = new BranchTreeItem(
        `Conflict detected - cannot diff between branches`,
        TreeItemType.Conflict,
        vscode.TreeItemCollapsibleState.None
      );
      conflictItem.tooltip = diffResult.error || 'Merge conflict detected between branches';
      items.push(conflictItem);
      return items;
    }

    // Show error if any
    if (diffResult.error) {
      const errorItem = new BranchTreeItem(
        `Error: ${diffResult.error}`,
        TreeItemType.Conflict,
        vscode.TreeItemCollapsibleState.None
      );
      items.push(errorItem);
      return items;
    }

    // Add file count info
    const fileCount = diffResult.changes.length;
    if (fileCount === 0) {
      items.push(
        new BranchTreeItem(
          'No changes',
          TreeItemType.Info,
          vscode.TreeItemCollapsibleState.None
        )
      );
      return items;
    }

    const countItem = new BranchTreeItem(
      `${fileCount} file${fileCount > 1 ? 's' : ''} changed`,
      TreeItemType.Info,
      vscode.TreeItemCollapsibleState.None
    );
    items.push(countItem);

    // Build folder tree and add root level items
    this._folderTree = this.buildFolderTree(diffResult.changes);
    const rootItems = this.createTreeItems(this._folderTree);
    items.push(...rootItems);

    return items;
  }

  private buildFolderTree(changes: Change[]): FolderNode {
    const root: FolderNode = {
      name: '',
      path: '',
      children: new Map(),
      files: [],
    };

    const repoRoot = this.gitService.getRepository()?.rootUri.fsPath || '';

    for (const change of changes) {
      // Get relative path from repo root
      let relativePath = change.uri.fsPath;
      if (relativePath.startsWith(repoRoot)) {
        relativePath = relativePath.substring(repoRoot.length);
        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
          relativePath = relativePath.substring(1);
        }
      }

      const parts = relativePath.split(/[/\\]/);
      parts.pop(); // Remove filename, keep only folder parts

      // Navigate/create folder structure
      let current = root;
      let currentPath = '';

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (!current.children.has(part)) {
          current.children.set(part, {
            name: part,
            path: currentPath,
            children: new Map(),
            files: [],
          });
        }
        current = current.children.get(part)!;
      }

      // Add file to current folder
      current.files.push(change);
    }

    return root;
  }

  private createTreeItems(node: FolderNode): BranchTreeItem[] {
    const items: BranchTreeItem[] = [];

    // Sort folders first, then files
    const sortedFolders = Array.from(node.children.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    const sortedFiles = node.files.sort((a, b) => {
      const aName = a.uri.path.split('/').pop() || '';
      const bName = b.uri.path.split('/').pop() || '';
      return aName.localeCompare(bName);
    });

    // Add folders
    const repoRoot = this.gitService.getRepository()?.rootUri.fsPath || '';
    for (const folder of sortedFolders) {
      const folderItem = new BranchTreeItem(
        folder.name,
        TreeItemType.Folder,
        vscode.TreeItemCollapsibleState.Expanded,
        folder.path
      );
      // Set resourceUri to enable theme-based folder icons
      folderItem.resourceUri = vscode.Uri.file(`${repoRoot}/${folder.path}`);
      items.push(folderItem);
    }

    // Add files
    for (const change of sortedFiles) {
      const fileName = change.uri.path.split('/').pop() || change.uri.path;
      const item = new BranchTreeItem(
        fileName,
        TreeItemType.File,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        change
      );

      // Set resourceUri to enable theme-based file icons
      item.resourceUri = change.uri;
      item.tooltip = change.uri.fsPath;
      item.command = {
        command: 'branch-diff.showFileDiff',
        title: 'Show Diff',
        arguments: [change, this._target, this._source],
      };

      items.push(item);
    }

    return items;
  }

  private getFolderChildren(folderPath: string): BranchTreeItem[] {
    if (!this._folderTree) {
      return [];
    }

    // Navigate to the folder
    const parts = folderPath.split('/');
    let current = this._folderTree;

    for (const part of parts) {
      const child = current.children.get(part);
      if (!child) {
        return [];
      }
      current = child;
    }

    return this.createTreeItems(current);
  }

  private getSourceLabel(): string {
    if (this._source.type === 'workingTree') {
      const currentBranch = this.gitService.getCurrentBranchName();
      return `Working Tree (${currentBranch})`;
    }
    return this._source.branchName || 'Unknown';
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
