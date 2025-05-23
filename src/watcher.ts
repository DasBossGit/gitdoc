import * as vscode from "vscode";
import config from "./config";
import { ForcePushMode, GitAPI, Repository, RefType } from "./git";
import { DateTime } from "luxon";
import { store } from "./store";
import { reaction } from "mobx";
import { logger } from "./logger";
import { updateContext } from "./utils";
import { minimatch } from "minimatch";

const REMOTE_NAME = "origin";

async function pushRepository(
	repository: Repository,
	forcePush: boolean = false
) {
	if (!(await hasRemotes(repository))) {
		logger.info("No remotes found, aborting push...");
		return;
	}

	store.isPushing = true;

	try {
		logger.info("Pushing changes to remote...");

		if (config.autoPull === "onPush") {
			await pullRepository(repository);
		}

		const pushArgs: any[] = [
			REMOTE_NAME,
			repository.state.HEAD?.name,
			false,
		];

		if (forcePush) {
			pushArgs.push(ForcePushMode.Force);
		} else if (config.pushMode !== "push") {
			const pushMode =
				config.pushMode === "forcePush"
					? ForcePushMode.Force
					: ForcePushMode.ForceWithLease;

			pushArgs.push(pushMode);
		}

		await repository.push(...pushArgs);

		logger.info("Changes pushed to remote.");

		store.isPushing = false;
	} catch {
		store.isPushing = false;

		vscode.window.showWarningMessage(
			"Remote repository contains conflicting changes.",
			"Force Push"
		).then(async (selection) => {
			if (selection === "Force Push") {
				logger.debug("Forcing push...");
				await pushRepository(repository, true);
			}
			store.isPushing = false;
		}, () => {
			logger.debug("Push cancelled by user.");
			store.isPushing = false;
		});
	} finally {
		store.isPushing = false;
	}
}

async function pullRepository(repository: Repository) {
	if (!(await hasRemotes(repository))) {
		logger.info("No remotes found, aborting pull...");
		return;
	}

	store.isPulling = true;

	logger.info("Pulling remote changes...");

	await repository.pull();

	logger.info("Remote changes pulled.");

	store.isPulling = false;
}

async function hasRemotes(repository: Repository): Promise<boolean> {
	const refs = await repository.getRefs();
	return refs.some((ref) => ref.type === RefType.RemoteHead);
}

function matches(uri: vscode.Uri, filter: string | Array<string>, case_sensitive: boolean = true, partial: boolean = false) {
	logger.info(
		`Checking if URI matches filter [${uri.fsPath}]...`,
	);
	var filters: Array<string> = [];
	if ("string" == typeof (filter)) {
		filters = [filter]
	} else {
		filters = filter;
	}

	const opt = { dot: true, nocase: !case_sensitive, partial: partial }

	var res = filters.some((predicate) => {
		return (minimatch.match([uri.path, uri.fsPath, vscode.workspace.asRelativePath(uri.path, false), vscode.workspace.asRelativePath(uri.fsPath, false), vscode.workspace.asRelativePath(uri.path, true), vscode.workspace.asRelativePath(uri.fsPath, true), `/${vscode.workspace.asRelativePath(uri.path, false)}`, `/${vscode.workspace.asRelativePath(uri.fsPath, false)}`], predicate, opt).length > 0)
	});

	logger.info(`URI does${res ? "" : " not"} match filter [${filters}]`)
	return res;
}

async function generateCommitMessage(
	repository: Repository,
	changedUris: vscode.Uri[]
): Promise<string | null> {
	logger.debug("AI generating commit message...");
	const diffs = await Promise.all(
		changedUris.map(async (uri) => {
			const relativeFilePath = vscode.workspace.asRelativePath(uri);
			const absoluteFilePath = uri.fsPath;
			logger.info(
				`Changes found in file [${relativeFilePath}] [${absoluteFilePath}]`,
			);
			let out = null;
			try {
				//check if file exist
				if (!require("fs").existsSync(absoluteFilePath)) {
					return ``;
				}
				const fileDiff = await repository.diffWithHEAD(
					absoluteFilePath
				);
				out = `## ${relativeFilePath}
---
${fileDiff}`;
			} catch (e) {
				logger.error(e);
			}
			if (out) return out;
			return `## ${relativeFilePath}
---
Error: Unable to generate diff for this file.`;
		})
	);

	logger.debug("Selecting AI model...");

	const model = await vscode.lm.selectChatModels({ family: config.aiModel });
	if (!model || model.length === 0) {
		logger.error("No AI model found.");
		config.aiEnabled = false;
		vscode.window.showWarningMessage(
			("AI model not found, unable to generate commit message with " + config.aiModel),
			{
				detail: 'Check for updates on the GitHub Copilot extension and or copilot subscription.\n\nDisabling AI commits...',
				modal: true
			}
		);
		throw ("AI model not found, unable to generate commit message with " + config.aiModel);
	}

	logger.debug("AI model found: ", model[0].name);
	logger.debug("Preparing commit message prompt...");

	const prompt = `# Instructions

You are a professional developer working on a project that uses Git for version control. You have made some changes to the codebase and are preparing to commit them to the repository. Your task is to summarize the changes that you have made into a concise commit message that describes the essence of the changes that were made.

* Always start the commit message with a present tense verb such as "Update", "Fix", "Modify", "Add", "Improve", "Organize", "Arrange", "Mark", etc.
* Respond in plain text, with no markdown formatting, and without any extra content. Simply respond with the commit message, and without a trailing period.
* Don't reference the file paths that were changed, but make sure to summarize all significant changes (using your best judgement).
* When multiple project modifiying actions occur, prioritize edited files, followed by added files, and then renamed/deleted files.
* When multiple files have been edited, give priority to the structure in which edits may relate to another, e.g. one function added that changes the entire flow of the project.
* When a change includes adding an emoji to a list item in markdown or any style of ToDo List, then interpret a runner emoji as marking it as in progress, a checkmark emoji as meaning its completed, and a muscle emoji as meaning its a stretch goal.
* The only exception to the above rule is when a change read 'Error: Unable to generate diff for this file.', in which case you shall NOT mention that the file could not be diffed.
${config.aiUseEmojis
			? "* Prepend an emoji to the message that expresses the nature of the changes, and is as specific/relevant to the subject and/or action of the changes as possible.\n"
			: ""
		}
# Code change diffs

${diffs.join("\n\n")}

${config.aiCustomInstructions
			? `# Additional Instructions (Important!)

${config.aiCustomInstructions}
`
			: ""
		}
# Commit message

`;

	logger.trace(`Prompt: ${prompt}`);

	logger.debug("Sending request...");

	const response = await model[0].sendRequest([
		{
			role: vscode.LanguageModelChatMessageRole.User,
			name: "User",
			content: prompt,
		},
	]);

	let summary = "";
	for await (const part of response.text) {
		summary += part;
	}

	logger.trace("Received response: ", summary);

	return summary;
}

export async function commit(repository: Repository, message?: string) {
	// This function shouldn't ever be called when GitDoc
	// is disabled, but we're checking it just in case.
	try {
		logger.info("Committing changes...");

		if (store.enabled === false || store.isPushing) {
			logger.debug(`Extension is ${(store.isPushing ? "pushing" : "disabled")}, aborting commit...`);
			return
		};

		store.isPushing = true;

		const changes = [
			...repository.state.workingTreeChanges,
			...repository.state.mergeChanges,
			...repository.state.indexChanges,
		];

		if (changes.length === 0) {
			logger.info("No changes to commit.");
			store.isPushing = false;
			return;
		}

		logger.trace("Fetching changes from repository...");

		const excludeFilters = config.excludeFilters;


		const changedUris = changes
			.filter((change) => matches(change.uri, config.filePattern))
			.filter((change) => {
				logger.info("Checking if change uri matches any exclude filter")
				var res = matches(change.uri, config.excludeFilters, config.excludeFiltersCaseSense, true);
				if (res) {
					console.error("Exclude filter matches")
					var caseSense = config.excludeFiltersCaseSense;
					excludeFilters.forEach((predicate) => {
						(minimatch.match([change.uri.path, change.uri.fsPath], predicate, { dot: true, nocase: caseSense }) ? (logger.warn(`Exclude-filter [${predicate}] matches URI [${change.uri.fsPath}]`)) : false)
					})
				}
				return !res;
			})
			.map((change) => change.uri);

		if (changedUris.length === 0) {
			logger.info("No changes to commit.");
			store.isPushing = false;
			return;
		}

		if (config.commitValidationLevel !== "none") {
			logger.debug(
				"Checking changes against validation level..."
			);
			const diagnostics = vscode.languages
				.getDiagnostics()
				.filter(([uri, diagnostics]) => {
					const isChanged = changedUris.find(
						(changedUri) =>
							changedUri.toString().localeCompare(uri.toString()) ===
							0
					);

					return isChanged
						? diagnostics.some(
							(diagnostic) =>
								diagnostic.severity ===
								vscode.DiagnosticSeverity.Error ||
								(config.commitValidationLevel === "warning" &&
									diagnostic.severity ===
									vscode.DiagnosticSeverity.Warning)
						)
						: false;
				});

			if (diagnostics.length > 0) {
				store.isPushing = false;
				logger.warn(
					"Changes contain errors or warnings, aborting commit..."
				);
				return;
			}
		}

		let currentTime = DateTime.now();

		// Ensure that the commit dates are formatted
		// as UTC, so that other clients can properly
		// re-offset them based on the user's locale.
		const commitDate = currentTime.toUTC().toString();
		process.env.GIT_AUTHOR_DATE = commitDate;
		process.env.GIT_COMMITTER_DATE = commitDate;

		if (config.timeZone) {
			currentTime = currentTime.setZone(config.timeZone);
		}


		let commitMessage = "";

		if (config.aiEnabled) {
			const aiMessage = await generateCommitMessage(repository, changedUris);
			if (aiMessage) {
				commitMessage = aiMessage;
			}
		} else {
			logger.debug("Generating commit message using default format...");

			commitMessage = message || currentTime.toFormat(config.commitMessageFormat);

			logger.trace("Commit message: ", commitMessage);
		}

		logger.info("Committing changes...");

		await repository.commit(commitMessage, {
			all: true,
			noVerify: config.noVerify,
		});

		store.lastCommitSuccessful = true;

		delete process.env.GIT_AUTHOR_DATE;
		delete process.env.GIT_COMMITTER_DATE;

		logger.info("Changes committed.");

		if (config.autoPush === "onCommit") {
			logger.info("Pushing changes...");
			await pushRepository(repository);
		}

		if (config.autoPull === "onCommit") {
			logger.info("Pulling changes...");
			await pullRepository(repository);
		}
		store.isPushing = false;
	} catch (e) {
		logger.error(e);
		store.isPushing = false;
		if (store.lastCommitSuccessful === false) {
			logger.error("Commit failed twice, aborting and disabling GitDoc...");
			store.enabled = false;
			updateContext(false, true);
			store.isPulling = false;
			store.isCommitting = false;

			vscode.window.showWarningMessage(
				("GitDoc failed to commit twice, disabling..."),
				{
					detail: 'Check config and logs. Enable GitDoc again to re-enable it.',
					modal: true
				}
			);
		}
		store.lastCommitSuccessful = false;
		throw e;
	}
}

// TODO: Clear the timeout when GitDoc is disabled.
function debounce(fn: Function, delay: number, origin?: string) {
	let timeout: NodeJS.Timeout | null = null;

	logger.debug("Creating new debounced function...");

	return (...args: any[]) => {
		if (timeout) {
			logger.debug("Clearing existing timeout...");
			clearTimeout(timeout);

		}

		logger.debug(`Setting new timeout (${delay})...`);
		logger.trace(`Timeout ${origin ? `originates from: ${origin}` : "<anonymously> provided"}`);
		timeout = setTimeout(() => {
			fn(...args);
		}, delay);
	};
}

const commitMap = new Map();
function debouncedCommit(repository: Repository, origin?: string): () => void {
	logger.debug("Debouncing commit...");
	if (!commitMap.has(repository)) {
		logger.debug("Creating new <anonym> debounced commit function...");
		commitMap.set(
			repository,
			debounce(() => commit(repository), config.autoCommitDelay, origin)
		);
	}

	return commitMap.get(repository);
}

let statusBarItem: vscode.StatusBarItem | null = null;
export function ensureStatusBarItem() {
	logger.debug("Ensuring status bar item exists...");

	if (!statusBarItem) {
		logger.debug("Creating new status bar item...");
		statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			-100
		);

		statusBarItem.text = "$(mirror)";
		statusBarItem.tooltip = "GitDoc: Auto-commiting files on save";
		statusBarItem.command = "gitdoc.disable";
		statusBarItem.show();
	}

	return statusBarItem;
}

let disposables: vscode.Disposable[] = [];
export function watchForChanges(git: GitAPI): vscode.Disposable {
	logger.debug("Starting Watcher...");

	const commitAfterDelay = debouncedCommit(git.repositories[0], `watchForChanges @ watcher.ts:${getCurrentLine()}`);

	disposables.push(git.repositories[0].state?.onDidChange(commitAfterDelay));

	ensureStatusBarItem();

	disposables.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor && (matches(editor.document.uri, config.filePattern) && !matches(editor.document.uri, config.excludeFilters, config.excludeFiltersCaseSense, true))) {
				statusBarItem?.show();
			} else {
				statusBarItem?.hide();
			}
		})
	);

	if (
		vscode.window.activeTextEditor &&
		(matches(vscode.window.activeTextEditor.document.uri, config.filePattern) && !matches(vscode.window.activeTextEditor.document.uri, config.excludeFilters, config.excludeFiltersCaseSense, true))
	) {
		statusBarItem?.show();
	} else {
		statusBarItem?.hide();
	}

	disposables.push({
		dispose: () => {
			statusBarItem?.dispose();
			statusBarItem = null;
		},
	});

	logger.debug(
		"Registering repository push/pull timeouts..."
	);

	if (config.autoPush === "afterDelay") {
		const interval = setInterval(async () => {
			pushRepository(git.repositories[0]);
		}, config.autoPushDelay);

		disposables.push({
			dispose: () => {
				clearInterval(interval);
			},
		});
	}

	if (config.autoPull === "afterDelay") {
		const interval = setInterval(
			async () => pullRepository(git.repositories[0]),
			config.autoPullDelay
		);

		disposables.push({
			dispose: () => clearInterval(interval),
		});
	}

	const reactionDisposable = reaction(
		() => [store.isPushing, store.isPulling],
		() => {
			const suffix = store.isPushing
				? " (Pushing...)"
				: store.isPulling
					? " (Pulling...)"
					: "";
			statusBarItem!.text = `$(mirror)${suffix}`;
		}
	);

	disposables.push({
		dispose: reactionDisposable,
	});

	if (config.pullOnOpen) {
		pullRepository(git.repositories[0]);
	}

	logger.debug("Watcher started");

	// Check if the repository currently has uncommitted changes
	if (git.repositories[0].state.workingTreeChanges.length > 0) {
		logger.info("Repository has uncommitted changes, committing after 15 second delay...");
		// Commit the changes after a delay of 45 seconds
		setTimeout(() => {
			commit(git.repositories[0]);
		}, 45000);
	}

	return {
		dispose: () => {
			disposables.forEach((disposable) => disposable.dispose());
			disposables = [];
		},
	};
}

function getCurrentLine(nullUnknown: boolean = true): string | null {
	const err = new Error();
	const stackLine = err.stack?.split('\n')[2] || '';
	// Extract line number from stack trace (browser/environment dependent)
	const lineMatch = stackLine.match(/:(\d+):\d+/);
	return lineMatch ? lineMatch[1] : nullUnknown ? null : 'unknown';
}