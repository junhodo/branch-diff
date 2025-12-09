import * as vscode from 'vscode';
import { GitService } from './git/gitService';
import { BranchTreeProvider } from './views/branchTreeProvider';
import { DiffCommands } from './commands/diffCommands';
import { Change, SourceSelection } from './git/types';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Branch Diff extension is activating...');

  // Initialize Git Service
  const gitService = new GitService();
  const initialized = await gitService.initialize();

  if (!initialized) {
    console.warn('Branch Diff: Git service initialization failed');
    return;
  }

  // Create TreeView Provider
  const treeProvider = new BranchTreeProvider(gitService);

  // Create TreeView
  const treeView = vscode.window.createTreeView('branchDiffView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Create Diff Commands handler
  const diffCommands = new DiffCommands(gitService, treeProvider);

  // Register commands
  const refreshCommand = vscode.commands.registerCommand(
    'branch-diff.refresh',
    () => {
      treeProvider.refresh();
    }
  );

  const changeSourceCommand = vscode.commands.registerCommand(
    'branch-diff.changeSource',
    () => {
      diffCommands.changeSource();
    }
  );

  const showFileDiffCommand = vscode.commands.registerCommand(
    'branch-diff.showFileDiff',
    (change: Change, targetBranch: string, source: SourceSelection) => {
      diffCommands.showFileDiff(change, targetBranch, source);
    }
  );

  // Listen for repository state changes
  const repo = gitService.getRepository();
  if (repo) {
    context.subscriptions.push(
      repo.state.onDidChange(() => {
        treeProvider.refresh();
      })
    );
  }

  // Listen for repository open/close
  context.subscriptions.push(
    gitService.onDidChangeRepository(() => {
      treeProvider.refresh();
    })
  );

  // Register all disposables
  context.subscriptions.push(
    treeView,
    refreshCommand,
    changeSourceCommand,
    showFileDiffCommand,
    { dispose: () => gitService.dispose() },
    { dispose: () => treeProvider.dispose() }
  );

  console.log('Branch Diff extension activated successfully!');
}

export function deactivate() {
  console.log('Branch Diff extension deactivated');
}
