import * as vscode from 'vscode';
import {
  GitExtension,
  API,
  Repository,
  Branch,
  Ref,
  RefType,
  Change,
  BranchInfo,
  SourceSelection,
} from './types';

export class GitService {
  private api: API | undefined;
  private _onDidChangeRepository = new vscode.EventEmitter<void>();
  readonly onDidChangeRepository = this._onDidChangeRepository.event;

  private disposables: vscode.Disposable[] = [];

  async initialize(): Promise<boolean> {
    const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

    if (!gitExtension) {
      vscode.window.showErrorMessage('Branch Diff: Git extension not found');
      return false;
    }

    if (!gitExtension.isActive) {
      await gitExtension.activate();
    }

    const git = gitExtension.exports;
    if (!git.enabled) {
      vscode.window.showErrorMessage('Branch Diff: Git extension is disabled');
      return false;
    }

    this.api = git.getAPI(1);

    // Listen for repository changes
    this.disposables.push(
      this.api.onDidOpenRepository(() => this._onDidChangeRepository.fire()),
      this.api.onDidCloseRepository(() => this._onDidChangeRepository.fire())
    );

    return true;
  }

  getRepository(): Repository | undefined {
    if (!this.api || this.api.repositories.length === 0) {
      return undefined;
    }
    return this.api.repositories[0];
  }

  getCurrentBranch(): Branch | undefined {
    const repo = this.getRepository();
    return repo?.state.HEAD;
  }

  getCurrentBranchName(): string {
    const branch = this.getCurrentBranch();
    return branch?.name || 'HEAD';
  }

  async getLocalBranches(): Promise<BranchInfo[]> {
    const repo = this.getRepository();
    if (!repo) {
      return [];
    }

    try {
      const refs = await repo.getBranches({ remote: false });
      const currentBranch = this.getCurrentBranchName();

      return refs
        .filter((ref): ref is Ref & { name: string } =>
          ref.type === RefType.Head && !!ref.name && ref.name !== currentBranch
        )
        .map(ref => ({
          name: ref.name,
          isRemote: false,
          commit: ref.commit,
        }));
    } catch (error) {
      console.error('Error getting local branches:', error);
      return [];
    }
  }

  async getRemoteBranches(): Promise<BranchInfo[]> {
    const repo = this.getRepository();
    if (!repo) {
      return [];
    }

    try {
      const refs = await repo.getBranches({ remote: true });

      return refs
        .filter((ref): ref is Ref & { name: string } =>
          ref.type === RefType.RemoteHead && !!ref.name
        )
        .map(ref => ({
          name: ref.name,
          isRemote: true,
          remoteName: ref.remote,
          commit: ref.commit,
        }));
    } catch (error) {
      console.error('Error getting remote branches:', error);
      return [];
    }
  }

  async getAllBranches(): Promise<{ local: BranchInfo[]; remote: BranchInfo[] }> {
    const [local, remote] = await Promise.all([
      this.getLocalBranches(),
      this.getRemoteBranches(),
    ]);
    return { local, remote };
  }

  /**
   * Get diff between source and target branch
   * @param source - Source selection (working tree or specific branch)
   * @param targetBranch - Target branch to compare against
   */
  async getDiff(source: SourceSelection, targetBranch: string): Promise<Change[]> {
    const repo = this.getRepository();
    if (!repo) {
      return [];
    }

    try {
      if (source.type === 'workingTree') {
        // Working tree (current state including uncommitted changes) vs target branch
        // This compares: targetBranch -> working tree
        return await repo.diffWith(targetBranch);
      } else if (source.branchName) {
        // Specific branch vs target branch
        return await repo.diffBetween(targetBranch, source.branchName);
      }
      return [];
    } catch (error) {
      console.error('Error getting diff:', error);
      return [];
    }
  }

  /**
   * Get diff with conflict detection
   * @param source - Source selection (working tree or specific branch)
   * @param targetBranch - Target branch to compare against
   */
  async getDiffWithConflictDetection(
    source: SourceSelection,
    targetBranch: string
  ): Promise<{ changes: Change[]; hasConflict: boolean; error?: string }> {
    const repo = this.getRepository();
    if (!repo) {
      return { changes: [], hasConflict: false, error: 'No repository found' };
    }

    try {
      let changes: Change[];

      // For remote branches, we need to use the full ref name
      // VS Code Git API expects refs like 'origin/main' for remote branches
      const targetRef = targetBranch;

      if (source.type === 'workingTree') {
        changes = await repo.diffWith(targetRef);
      } else if (source.branchName) {
        changes = await repo.diffBetween(targetRef, source.branchName);
      } else {
        return { changes: [], hasConflict: false };
      }

      return { changes, hasConflict: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error getting diff:', error);

      // Check for specific error types
      const isBadRevision =
        errorMessage.includes('bad revision') ||
        errorMessage.includes('unknown revision') ||
        errorMessage.includes('not a valid object name');

      const isConflict =
        errorMessage.includes('conflict') ||
        errorMessage.includes('CONFLICT') ||
        errorMessage.includes('BOTH_MODIFIED');

      if (isBadRevision) {
        return {
          changes: [],
          hasConflict: false,
          error: `Branch not found: ${targetBranch}. Try running 'git fetch' first.`,
        };
      }

      if (isConflict) {
        return {
          changes: [],
          hasConflict: true,
          error: 'Merge conflict detected between branches',
        };
      }

      return {
        changes: [],
        hasConflict: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get the content of a file at a specific ref
   */
  async getFileContent(ref: string, path: string): Promise<string | undefined> {
    const repo = this.getRepository();
    if (!repo) {
      return undefined;
    }

    try {
      return await repo.show(ref, path);
    } catch (error) {
      console.error(`Error getting file content for ${path} at ${ref}:`, error);
      return undefined;
    }
  }

  /**
   * Create a Git URI for viewing file content at a specific ref
   * Uses our custom scheme 'branch-diff-git' to avoid repository lookup issues
   */
  createGitUri(uri: vscode.Uri, ref: string): vscode.Uri {
    const repo = this.getRepository();
    if (!repo) {
      return uri;
    }

    // Get the path relative to the repository root
    const repoRoot = repo.rootUri.fsPath;
    let relativePath = uri.fsPath;
    if (relativePath.startsWith(repoRoot)) {
      relativePath = relativePath.substring(repoRoot.length);
      if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        relativePath = relativePath.substring(1);
      }
    }

    // Use our custom scheme that handles content via repo.show()
    return vscode.Uri.from({
      scheme: 'branch-diff-git',
      path: uri.fsPath,
      query: JSON.stringify({
        path: relativePath,
        ref: ref,
      }),
    });
  }

  dispose(): void {
    this._onDidChangeRepository.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
