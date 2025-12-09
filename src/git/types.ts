import * as vscode from 'vscode';

// VS Code Git Extension API Types
// Based on: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}

export interface API {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  readonly onDidCloseRepository: vscode.Event<Repository>;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly inputBox: InputBox;
  readonly state: RepositoryState;
  readonly ui: RepositoryUIState;

  getBranch(name: string): Promise<Branch>;
  getBranches(query: { remote?: boolean }): Promise<Ref[]>;
  getCommit(ref: string): Promise<Commit>;

  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
  diffWith(ref: string): Promise<Change[]>;
  diffIndexWith(ref: string): Promise<Change[]>;
  diffIndexWithHEAD(): Promise<Change[]>;

  show(ref: string, path: string): Promise<string>;

  // For executing raw git commands
  diff(ref1: string, ref2: string): Promise<string>;
}

export interface InputBox {
  value: string;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly refs: Ref[];
  readonly remotes: Remote[];
  readonly submodules: Submodule[];
  readonly rebaseCommit: Commit | undefined;
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly onDidChange: vscode.Event<void>;
}

export interface RepositoryUIState {
  readonly selected: boolean;
  readonly onDidChange: vscode.Event<void>;
}

export interface Branch extends Ref {
  readonly upstream?: Upstream;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Upstream {
  readonly remote: string;
  readonly name: string;
}

export interface Ref {
  readonly type: RefType;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export enum RefType {
  Head = 0,
  RemoteHead = 1,
  Tag = 2
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
  readonly isReadOnly: boolean;
}

export interface Submodule {
  readonly name: string;
  readonly path: string;
  readonly url: string;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
  readonly commitDate?: Date;
}

export interface Change {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
  readonly status: Status;
}

export enum Status {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED
}

// Custom types for our extension
export interface BranchInfo {
  name: string;
  isRemote: boolean;
  remoteName?: string;
  commit?: string;
}

export type SourceType = 'workingTree' | 'branch';

export interface SourceSelection {
  type: SourceType;
  branchName?: string;
}
