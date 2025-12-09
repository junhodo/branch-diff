import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { BranchInfo, Change, SourceSelection, Status } from '../git/types';

export enum TreeItemType {
  Source = 'source',
  LocalRoot = 'localRoot',
  RemoteRoot = 'remoteRoot',
  Branch = 'branch',
  File = 'file',
}

export class BranchTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly itemType: TreeItemType,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly branchName?: string,
    public readonly isRemote?: boolean,
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
      case TreeItemType.LocalRoot:
        this.iconPath = new vscode.ThemeIcon('git-branch');
        break;
      case TreeItemType.RemoteRoot:
        this.iconPath = new vscode.ThemeIcon('cloud');
        break;
      case TreeItemType.Branch:
        this.iconPath = new vscode.ThemeIcon('git-branch');
        break;
      case TreeItemType.File:
        this.iconPath = vscode.ThemeIcon.File;
        this.setupFileDecoration();
        break;
    }
  }

  private setupFileDecoration(): void {
    if (!this.change) {
      return;
    }

    // Set description based on status
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
    }
  }
}

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _source: SourceSelection = { type: 'workingTree' };
  private _changesCache = new Map<string, Change[]>();

  constructor(private gitService: GitService) {}

  get source(): SourceSelection {
    return this._source;
  }

  setSource(source: SourceSelection): void {
    this._source = source;
    this._changesCache.clear();
    this.refresh();
  }

  refresh(): void {
    this._changesCache.clear();
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
          TreeItemType.Source,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }

    if (!element) {
      return this.getRootItems();
    }

    switch (element.itemType) {
      case TreeItemType.LocalRoot:
        return this.getLocalBranchItems();
      case TreeItemType.RemoteRoot:
        return this.getRemoteBranchItems();
      case TreeItemType.Branch:
        if (element.branchName) {
          return this.getChangedFiles(element.branchName);
        }
        return [];
      default:
        return [];
    }
  }

  private getRootItems(): BranchTreeItem[] {
    const sourceLabel = this.getSourceLabel();

    return [
      new BranchTreeItem(
        `Source: ${sourceLabel}`,
        TreeItemType.Source,
        vscode.TreeItemCollapsibleState.None
      ),
      new BranchTreeItem(
        'Local Branches',
        TreeItemType.LocalRoot,
        vscode.TreeItemCollapsibleState.Expanded
      ),
      new BranchTreeItem(
        'Remote Branches',
        TreeItemType.RemoteRoot,
        vscode.TreeItemCollapsibleState.Collapsed
      ),
    ];
  }

  private getSourceLabel(): string {
    if (this._source.type === 'workingTree') {
      const currentBranch = this.gitService.getCurrentBranchName();
      return `Working Tree (${currentBranch})`;
    }
    return this._source.branchName || 'Unknown';
  }

  private async getLocalBranchItems(): Promise<BranchTreeItem[]> {
    const branches = await this.gitService.getLocalBranches();
    return this.createBranchItems(branches);
  }

  private async getRemoteBranchItems(): Promise<BranchTreeItem[]> {
    const branches = await this.gitService.getRemoteBranches();
    return this.createBranchItems(branches);
  }

  private createBranchItems(branches: BranchInfo[]): BranchTreeItem[] {
    return branches.map(branch => {
      const displayName = branch.remoteName
        ? `${branch.remoteName}/${branch.name}`
        : branch.name;

      return new BranchTreeItem(
        displayName,
        TreeItemType.Branch,
        vscode.TreeItemCollapsibleState.Collapsed,
        displayName,
        branch.isRemote
      );
    });
  }

  private async getChangedFiles(targetBranch: string): Promise<BranchTreeItem[]> {
    // Check cache first
    if (this._changesCache.has(targetBranch)) {
      const cachedChanges = this._changesCache.get(targetBranch)!;
      return this.createFileItems(cachedChanges, targetBranch);
    }

    try {
      const changes = await this.gitService.getDiff(this._source, targetBranch);
      this._changesCache.set(targetBranch, changes);

      if (changes.length === 0) {
        return [
          new BranchTreeItem(
            'No changes',
            TreeItemType.File,
            vscode.TreeItemCollapsibleState.None
          ),
        ];
      }

      return this.createFileItems(changes, targetBranch);
    } catch (error) {
      console.error('Error getting changed files:', error);
      return [
        new BranchTreeItem(
          'Error loading changes',
          TreeItemType.File,
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }

  private createFileItems(changes: Change[], targetBranch: string): BranchTreeItem[] {
    return changes.map(change => {
      const fileName = change.uri.path.split('/').pop() || change.uri.path;
      const item = new BranchTreeItem(
        fileName,
        TreeItemType.File,
        vscode.TreeItemCollapsibleState.None,
        undefined,
        false,
        change
      );

      // Set tooltip to full path
      item.tooltip = change.uri.fsPath;

      // Set command to open diff
      item.command = {
        command: 'branch-diff.showFileDiff',
        title: 'Show Diff',
        arguments: [change, targetBranch, this._source],
      };

      return item;
    });
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
