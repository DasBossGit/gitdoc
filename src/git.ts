import * as vscode from "vscode";
import { logger } from "./logger";

interface CommitOptions {
  all?: boolean | "tracked";
  noVerify?: boolean;
}

export const enum RefType {
  Head,
  RemoteHead,
  Tag
}

interface Branch {
  readonly name: string;
  type: RefType;
}

interface RepositoryState {
  HEAD: Branch | undefined | null;
  refs: Branch[];
  workingTreeChanges: Change[];
  indexChanges: Change[];
  mergeChanges: Change[];
  onDidChange: vscode.Event<void>;
}

export interface Change {
  readonly uri: vscode.Uri;
}

export enum ForcePushMode {
  Force,
  ForceWithLease,
}

export interface Repository {
  state: RepositoryState;

  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  deleteBranch(name: string, force?: boolean): Promise<void>;

  checkout(treeish: string): Promise<void>;

  pull(unshallow?: boolean): Promise<void>;

  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
    forcePush?: ForcePushMode
  ): Promise<void>;

  commit(message: string, opts?: CommitOptions): Promise<void>;

  getRefs(): Promise<Branch[]>;

  diffWithHEAD(path: string): Promise<string>;
}

export interface GitAPI {
  repositories: Repository[];

  getRepository(uri: vscode.Uri): Repository | null;
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

export async function getGitApi(): Promise<GitAPI | undefined> {
  const extension = vscode.extensions.getExtension("vscode.git");
  if (!extension) {
    {
      logger.error("Git extension not found");
      return
    };
  }

  if (!extension.isActive) {
    try {
      await extension.activate()
    } catch (error) {
      logger.error("Git extension failed to activate");
      throw error;
    };
  }

  return extension.exports.getAPI(1);
}
