import * as vscode from "vscode";
import config from "./config";
import { ForcePushMode, GitAPI, Repository, RefType } from "./git";
import { DateTime } from "luxon";
import { store } from "./store";
import { reaction } from "mobx";
import * as minimatch from "minimatch";
import { EXTENSION_LOG_FMT } from "./constants";

const REMOTE_NAME = "origin";

async function pushRepository(
	repository: Repository,
	forcePush: boolean = false
) {
	if (!(await hasRemotes(repository))) {
		console.log(EXTENSION_LOG_FMT, "No remotes found, aborting push...");
		return;
	}

	store.isPushing = true;

	try {
		console.log(EXTENSION_LOG_FMT, "Pushing changes to remote...");

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

		console.log(EXTENSION_LOG_FMT, "Changes pushed to remote.");

		store.isPushing = false;
	} catch {
		store.isPushing = false;

		if (
			await vscode.window.showWarningMessage(
				"Remote repository contains conflicting changes.",
				"Force Push"
			)
		) {
			console.log(EXTENSION_LOG_FMT, "Forcing push...");
			await pushRepository(repository, true);
		}
	}
}

async function pullRepository(repository: Repository) {
	if (!(await hasRemotes(repository))) {
		console.log(EXTENSION_LOG_FMT, "No remotes found, aborting pull...");
		return;
	}

	store.isPulling = true;

	console.log(EXTENSION_LOG_FMT, "Pulling remote changes...");

	await repository.pull();

	console.log(EXTENSION_LOG_FMT, "Remote changes pulled.");

	store.isPulling = false;
}

async function hasRemotes(repository: Repository): Promise<boolean> {
	const refs = await repository.getRefs();
	return refs.some((ref) => ref.type === RefType.RemoteHead);
}

function matches(uri: vscode.Uri) {
	console.log(
		EXTENSION_LOG_FMT,
		"Checking if URI matches file pattern [%s]...",
		uri.path
	);
	return (
		minimatch(uri.path, config.filePattern, { dot: true }) ||
		minimatch(uri.fsPath, config.filePattern, { dot: true })
	);
}

async function generateCommitMessage(
	repository: Repository,
	changedUris: vscode.Uri[]
): Promise<string | null> {
	console.log(EXTENSION_LOG_FMT, "AI generating commit message...");
	const diffs = await Promise.all(
		changedUris.map(async (uri) => {
			const relativeFilePath = vscode.workspace.asRelativePath(uri);
			const absoluteFilePath = uri.fsPath;
			console.log(
				EXTENSION_LOG_FMT,
				"Changes found in file [%s] [%s]",
				relativeFilePath,
				absoluteFilePath
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
				console.error(EXTENSION_LOG_FMT, e);
			}
			if (out) return out;
			return `## ${relativeFilePath}
---
Error: Unable to generate diff for this file.`;
		})
	);

	console.log(EXTENSION_LOG_FMT, "Selecting AI model...");

	const model = await vscode.lm.selectChatModels({ family: config.aiModel });
	if (!model || model.length === 0) {
		console.error(EXTENSION_LOG_FMT, "No AI model found.");
		await vscode.window.showWarningMessage(

			("AI model not found, unable to generate commit message with " + config.aiModel),
			{
				detail: 'Check for updates on the GitHub Copilot extension and or copilot subscription.',
				modal: true
			}

		);

		return null;
	}

	const prompt = `# Instructions

You are a developer working on a project that uses Git for version control. You have made some changes to the codebase and are preparing to commit them to the repository. Your task is to summarize the changes that you have made into a concise commit message that describes the essence of the changes that were made.

* Always start the commit message with a present tense verb such as "Update", "Fix", "Modify", "Add", "Improve", "Organize", "Arrange", "Mark", etc.
* Respond in plain text, with no markdown formatting, and without any extra content. Simply respond with the commit message, and without a trailing period.
* Don't reference the file paths that were changed, but make sure summarize all significant changes (using your best judgement).
* When multiple files have been changed, give priority to edited files, followed by added files, and then renamed/deleted files.
* When a change includes adding an emoji to a list item in markdown, then interpret a runner emoji as marking it as in progress, a checkmark emoji as meaning its completed, and a muscle emoji as meaning its a stretch goal.
* The only exception to the above rule is when the the changes read ´Error: Unable to generate diff for this file.´, in which case you shall NOT mention that the file could not be diffed.
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

	console.log(EXTENSION_LOG_FMT, "Sending request...");

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

	return summary;
}

export async function commit(repository: Repository, message?: string) {
	// This function shouldn't ever be called when GitDoc
	// is disabled, but we're checking it just in case.
	try {
		if (store.enabled === false || store.isPushing) return;

		store.isPushing = true;

		console.log(EXTENSION_LOG_FMT, "Committing changes...");

		const changes = [
			...repository.state.workingTreeChanges,
			...repository.state.mergeChanges,
			...repository.state.indexChanges,
		];

		if (changes.length === 0) {
			console.log(EXTENSION_LOG_FMT, "No changes to commit.");
			store.isPushing = false;
			return;
		}

		const changedUris = changes
			.filter((change) => matches(change.uri))
			.map((change) => change.uri);

		if (changedUris.length === 0) {
			console.log(EXTENSION_LOG_FMT, "No changes to commit.");
			store.isPushing = false;
			return;
		}

		if (config.commitValidationLevel !== "none") {
			console.log(
				EXTENSION_LOG_FMT,
				"Checking cahnges against validation level..."
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
				console.log(
					EXTENSION_LOG_FMT,
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

		console.log(EXTENSION_LOG_FMT, "Formatting commit message...");

		let commitMessage =
			message || currentTime.toFormat(config.commitMessageFormat);

		if (config.aiEnabled) {
			const aiMessage = await generateCommitMessage(repository, changedUris);
			if (aiMessage) {
				commitMessage = aiMessage;
			}
		}

		console.log(EXTENSION_LOG_FMT, "Committing changes...");

		await repository.commit(commitMessage, {
			all: true,
			noVerify: config.noVerify,
		});

		delete process.env.GIT_AUTHOR_DATE;
		delete process.env.GIT_COMMITTER_DATE;

		console.log("Changes committed.");

		if (config.autoPush === "onCommit") {
			console.log("Pushing changes...");
			await pushRepository(repository);
		}

		if (config.autoPull === "onCommit") {
			console.log("Pulling changes...");
			await pullRepository(repository);
		}
		store.isPushing = false;
	} catch (e) {
		console.error(EXTENSION_LOG_FMT, e);
		store.isPushing = false;
		throw e;
	}
}

// TODO: Clear the timeout when GitDoc is disabled.
function debounce(fn: Function, delay: number) {
	let timeout: NodeJS.Timeout | null = null;

	console.log("Creating new debounced function...");

	return (...args: any[]) => {
		if (timeout) {
			console.log("Clearing existing timeout...");
			clearTimeout(timeout);
		}

		console.log("Setting new timeout (%s)...", delay);
		timeout = setTimeout(() => {
			fn(...args);
		}, delay);
	};
}

const commitMap = new Map();
function debouncedCommit(repository: Repository) {
	console.log("Debouncing commit...");
	if (!commitMap.has(repository)) {
		console.log("Creating new <anonym> debounced commit function...");
		commitMap.set(
			repository,
			debounce(() => commit(repository), config.autoCommitDelay)
		);
	}

	return commitMap.get(repository);
}

let statusBarItem: vscode.StatusBarItem | null = null;
export function ensureStatusBarItem() {
	console.log("Ensuring status bar item exists...");

	if (!statusBarItem) {
		console.log("Creating new status bar item...");
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
	console.log(EXTENSION_LOG_FMT, "Starting Watcher...");
	const commitAfterDelay = debouncedCommit(git.repositories[0]);
	disposables.push(git.repositories[0].state.onDidChange(commitAfterDelay));

	ensureStatusBarItem();

	disposables.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor && matches(editor.document.uri)) {
				statusBarItem?.show();
			} else {
				statusBarItem?.hide();
			}
		})
	);

	if (
		vscode.window.activeTextEditor &&
		matches(vscode.window.activeTextEditor.document.uri)
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

	console.log(
		EXTENSION_LOG_FMT,
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

	console.log(EXTENSION_LOG_FMT, "Watcher started");
	return {
		dispose: () => {
			disposables.forEach((disposable) => disposable.dispose());
			disposables = [];
		},
	};
}
