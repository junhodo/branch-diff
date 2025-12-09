import * as vscode from 'vscode';
import { GitService } from './gitService';

/**
 * Content provider for viewing file content at a specific git ref
 * This is used instead of the built-in git:// scheme to avoid repository lookup issues
 */
export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private gitService: GitService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const query = JSON.parse(uri.query);
      const { path, ref } = query;

      if (!path || !ref) {
        return '';
      }

      const content = await this.gitService.getFileContent(ref, path);
      return content || '';
    } catch (error) {
      console.error('Error providing git content:', error);
      return '';
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
