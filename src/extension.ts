import { reaction } from "mobx";
import * as vscode from "vscode";
import { registerCommands } from "./commands";
import config from "./config";
import { getGitApi, GitAPI, RefType } from "./git";
import { store } from "./store";
import { commit, watchForChanges, ensureStatusBarItem } from "./watcher";
import { updateContext } from "./utils";
import { EXTENSION_LOG_FMT } from "./constants";
import { createLogger } from "./logger";


export async function activate(context: vscode.ExtensionContext) {
	let logger = createLogger();
	logger.info('Hello World!');


	const git = await getGitApi();
	if (!git) {
		console.error(
			"VSCode internal Git extension not found. This is a bug."
		);
		return;
	}

	// Initialize the store based on the
	// user/workspace configuration.
	store.enabled = config.enabled;

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
				e.affectsConfiguration("gitdoc.filePattern")
			) {
				checkEnabled(git);
			}
		})
	);
	if (store.enabled) {
		console.log(EXTENSION_LOG_FMT, "Starting GitDoc...");
		ensureStatusBarItem();
		updateContext(true, false);
		watchForChanges(git);
		console.log(EXTENSION_LOG_FMT, "GitDoc watching for changes");
	}
}

let watcher: vscode.Disposable | null;
async function checkEnabled(git: GitAPI) {
	console.log(EXTENSION_LOG_FMT, "Checking if GitDoc should be enabled...");
	if (watcher) {
		watcher.dispose();
		watcher = null;
	}

	let branchName = git.repositories[0]?.state?.HEAD?.name;

	if (!branchName) {
		console.log(EXTENSION_LOG_FMT, "No branch found, trying to fetch...");
		const refs = await git.repositories[0]?.getRefs();
		branchName = refs?.find((ref) => ref.type === RefType.Head)?.name;
		console.log(EXTENSION_LOG_FMT, "Branch found:", branchName);
	}

	const enabled =
		git.repositories.length > 0 &&
		store.enabled &&
		!!branchName &&
		!config.excludeBranches.includes(branchName);

	console.log(
		EXTENSION_LOG_FMT,
		"GitDoc should %sbe enabled",
		enabled ? "" : "not "
	);
	updateContext(enabled, false);

	if (enabled) {
		watcher = watchForChanges(git);
	}
}

export async function deactivate() {
	if (store.enabled && config.commitOnClose) {
		const git = await getGitApi();
		if (git && git.repositories.length > 0) {
			return commit(git.repositories[0]);
		}
	}
}
