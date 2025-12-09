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
        // branch.name is already in format "origin/branch-name" for remote branches
        items.push({
          label: `$(cloud) ${branch.name}`,
          detail: branch.name,
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

  /**
   * Change the target branch with search functionality
   */
  async changeTarget(): Promise<void> {
    const { local, remote } = await this.gitService.getAllBranches();

    const allBranches: vscode.QuickPickItem[] = [];

    // Add local branches
    if (local.length > 0) {
      allBranches.push({
        label: 'Local Branches',
        kind: vscode.QuickPickItemKind.Separator,
      });

      for (const branch of local) {
        allBranches.push({
          label: `$(git-branch) ${branch.name}`,
          description: branch.commit?.substring(0, 7),
          detail: branch.name,
        });
      }
    }

    // Add remote branches
    if (remote.length > 0) {
      allBranches.push({
        label: 'Remote Branches',
        kind: vscode.QuickPickItemKind.Separator,
      });

      for (const branch of remote) {
        // branch.name is already in format "origin/branch-name" for remote branches
        allBranches.push({
          label: `$(cloud) ${branch.name}`,
          description: branch.commit?.substring(0, 7),
          detail: branch.name,
        });
      }
    }

    const selected = await vscode.window.showQuickPick(allBranches, {
      placeHolder: 'Search and select target branch to compare against',
      title: 'Select Target Branch',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (!selected || selected.kind === vscode.QuickPickItemKind.Separator || !selected.detail) {
      return;
    }

    this.treeProvider.setTarget(selected.detail);
  }

  /**
   * Open the current HEAD version of a file
   */
  async openCurrentFile(change?: Change): Promise<void> {
    try {
      let fileUri: vscode.Uri | undefined;

      if (change) {
        // Called from tree view context menu
        fileUri = change.uri;
      } else {
        // Called from editor title - get URI from active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const uri = activeEditor.document.uri;
          if (uri.scheme === 'git' || uri.scheme === 'branch-diff-git') {
            // Parse the git URI to get the actual file path
            const query = JSON.parse(uri.query);
            const repo = this.gitService.getRepository();
            if (repo && query.path) {
              fileUri = vscode.Uri.file(`${repo.rootUri.fsPath}/${query.path}`);
            }
          } else {
            fileUri = uri;
          }
        }
      }

      if (fileUri) {
        await vscode.window.showTextDocument(fileUri, { preview: false });
      }
    } catch (error) {
      console.error('Error opening current file:', error);
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  private getSourceLabel(source: SourceSelection): string {
    if (source.type === 'workingTree') {
      return 'Working Tree';
    }
    return source.branchName || 'Unknown';
  }
}
