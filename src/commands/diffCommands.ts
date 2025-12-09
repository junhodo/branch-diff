import * as vscode from 'vscode';
import { GitService } from '../git/gitService';
import { BranchTreeProvider } from '../views/branchTreeProvider';
import { Change, SourceSelection, BranchInfo } from '../git/types';

export class DiffCommands {
  constructor(
    private gitService: GitService,
    private treeProvider: BranchTreeProvider
  ) {}

  /**
   * Show diff for a specific file between source and target branch
   */
  async showFileDiff(
    change: Change,
    targetBranch: string,
    source: SourceSelection
  ): Promise<void> {
    try {
      const fileName = change.uri.path.split('/').pop() || 'file';

      // Left side: target branch version
      const leftUri = this.gitService.createGitUri(change.uri, targetBranch);

      // Right side: source version
      let rightUri: vscode.Uri;
      if (source.type === 'workingTree') {
        // Use the actual file URI for working tree
        rightUri = change.uri;
      } else if (source.branchName) {
        rightUri = this.gitService.createGitUri(change.uri, source.branchName);
      } else {
        rightUri = change.uri;
      }

      const title = `${fileName} (${targetBranch} ↔ ${this.getSourceLabel(source)})`;

      await vscode.commands.executeCommand(
        'vscode.diff',
        leftUri,
        rightUri,
        title,
        { preview: true }
      );
    } catch (error) {
      console.error('Error showing file diff:', error);
      vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
    }
  }

  /**
   * Change the source branch/working tree
   */
  async changeSource(): Promise<void> {
    const items: vscode.QuickPickItem[] = [];

    // Add working tree option
    const currentBranch = this.gitService.getCurrentBranchName();
    items.push({
      label: '$(git-commit) Working Tree',
      description: `Current state with uncommitted changes (${currentBranch})`,
      detail: 'workingTree',
    });

    // Add local branches
    const { local, remote } = await this.gitService.getAllBranches();

    if (local.length > 0) {
      items.push({
        label: 'Local Branches',
        kind: vscode.QuickPickItemKind.Separator,
      });

      for (const branch of local) {
        items.push({
          label: `$(git-branch) ${branch.name}`,
          detail: branch.name,
        });
      }
    }

    // Add remote branches
    if (remote.length > 0) {
      items.push({
        label: 'Remote Branches',
        kind: vscode.QuickPickItemKind.Separator,
      });

      for (const branch of remote) {
        const displayName = branch.remoteName
          ? `${branch.remoteName}/${branch.name}`
          : branch.name;
        items.push({
          label: `$(cloud) ${displayName}`,
          detail: displayName,
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select source to compare from',
      title: 'Change Source',
    });

    if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }

    if (selected.detail === 'workingTree') {
      this.treeProvider.setSource({ type: 'workingTree' });
    } else if (selected.detail) {
      this.treeProvider.setSource({
        type: 'branch',
        branchName: selected.detail,
      });
    }
  }

  private getSourceLabel(source: SourceSelection): string {
    if (source.type === 'workingTree') {
      return 'Working Tree';
    }
    return source.branchName || 'Unknown';
  }
}
