import { reaction } from "mobx";
import * as vscode from "vscode";
import { registerCommands } from "./commands";
import config from "./config";
import { getGitApi, GitAPI, RefType } from "./git";
import { store } from "./store";
import { commit, watchForChanges, ensureStatusBarItem } from "./watcher";
import { updateContext } from "./utils";
import { logger } from "./logger";

export async function activate(context: vscode.ExtensionContext) {
	console.error(vscode.workspace.asRelativePath(vscode.Uri.parse("a:\\Programming\\JavaScript\\Proxmox_VM_Viewer\\bla.testfile"), true))

	logger.info("Activating...");

	const git = await getGitApi();
	if (!git) {
		logger.error(
			"VSCode internal Git extension not found. This is a bug."
		);
		return;
	}


	// Initialize the store based on the
	// user/workspace configuration.
	store.enabled = config.enabled;
	store.lastCommitSuccessful = true;

	registerCommands(context);

	// Enable/disable the auto-commit watcher as the user
	// opens/closes Git repos, modifies their settings
	// and/or manually enables it via the command palette.
	context.subscriptions.push(
		git.onDidOpenRepository(() => checkEnabled(git))
	);
	context.subscriptions.push(
		git.onDidCloseRepository(() => checkEnabled(git))
	);

	reaction(
		() => [store.enabled],
		() => checkEnabled(git)
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (
				e.affectsConfiguration("gitdoc.enabled") ||
				e.affectsConfiguration("gitdoc.excludeBranches") ||
				e.affectsConfiguration("gitdoc.autoCommitDelay") ||
				e.affectsConfiguration("gitdoc.filePattern") ||
				e.affectsConfiguration("gitdoc.fullTrace")
			) {
				checkEnabled(git);
			}
		})
	);
	if (store.enabled) {
		logger.info("Starting GitDoc...");
		ensureStatusBarItem();
		updateContext(true, false);
		watchForChanges(git);
		logger.info("GitDoc watching for changes");
	}
}

let watcher: vscode.Disposable | null;
async function checkEnabled(git: GitAPI) {
	logger.debug("Checking if GitDoc should be enabled...");
	if (watcher) {
		watcher.dispose();
		watcher = null;
	}

	let branchName = git.repositories[0]?.state?.HEAD?.name;

	if (!branchName) {
		logger.info("No branch found, trying to fetch...");
		const refs = await git.repositories[0]?.getRefs();
		branchName = refs?.find((ref) => ref.type === RefType.Head)?.name;
		logger.info("Branch found:", branchName);
	}

	const enabled =
		git.repositories.length > 0 &&
		store.enabled &&
		!!branchName &&
		!config.excludeBranches.includes(branchName);

	logger.info(
		`GitDoc should ${(enabled ? "" : "not ")}be enabled`
	);
	updateContext(enabled, false);

	if (enabled) {
		watcher = watchForChanges(git);
	}
}

export async function deactivate() {
	store.lastCommitSuccessful = true;
	if (store.enabled && config.commitOnClose) {
		const git = await getGitApi();
		if (git && git.repositories.length > 0) {
			return commit(git.repositories[0]);
		}
	}
}
