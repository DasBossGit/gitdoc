import * as vscode from "vscode";
import { EXTENSION_NAME } from "./constants";
import { getGitApi } from "./git";
import { updateContext } from "./utils";
import { commit } from "./watcher";
import { logger } from "./logger";
import config from "./config";

interface GitTimelineItem {
	message: string;
	ref: string;
	previousRef: string;
}

export function registerCommands(context: vscode.ExtensionContext) {
	logger.debug("Registering commands...");
	function registerCommand(name: string, callback: (...args: any[]) => any) {
		context.subscriptions.push(
			vscode.commands.registerCommand(
				`${EXTENSION_NAME}.${name}`,
				callback
			)
		);
	}
	try {
		logger.debug("Registering 'enable' command...");
		registerCommand("enable", updateContext.bind(null, true));

		logger.debug("Registering 'disable' command...");
		registerCommand("disable", updateContext.bind(null, false));

		logger.debug("Registering 'restoreVersion' command...");
		registerCommand("restoreVersion", async (item: GitTimelineItem) => {
			if (!vscode.window.activeTextEditor) {
				logger.warn(
					"No active text editor found. Aborting."
				);
				return;
			}

			const path = vscode.workspace.asRelativePath(
				vscode.window.activeTextEditor.document.uri.path
			);

			const git = await getGitApi();

			// @ts-ignore
			await git?.repositories[0].repository.repository.checkout(
				item.ref,
				[path]
			);

			// TODO: Look into why the checkout
			// doesn't trigger the watcher.
			commit(git?.repositories[0]!);
		});

		logger.debug("Registering 'squashVersions' command...");
		registerCommand("squashVersions", async (item: GitTimelineItem) => {
			const message = await vscode.window.showInputBox({
				prompt: "Enter the name to give to the new squashed version",
				value: item.message,
			});

			if (message) {
				const git = await getGitApi();
				// @ts-ignore
				await git?.repositories[0].repository.reset(`${item.ref}~1`);
				await commit(git?.repositories[0]!, message);
			}
		});

		logger.debug("Registering 'undoVersion' command...");
		registerCommand("undoVersion", async (item: GitTimelineItem) => {
			const git = await getGitApi();

			// @ts-ignore
			await git?.repositories[0].repository.repository.run([
				"revert",
				"-n", // Tell Git not to create a commit, so that we can make one with the right message format
				item.ref,
			]);

			await commit(git?.repositories[0]!);
		});

		logger.debug("Registering 'commit' command...");
		registerCommand("commit", async () => {
			const git = await getGitApi();
			if (git && git.repositories.length > 0) {
				await commit(git.repositories[0]);
			}
		});

		logger.debug("Registering 'ai.availableModels' command...");
		registerCommand("ai.availableModels", async () => {
			try {
				logger.trace("Fetching available AI models...");
				const models = await vscode.lm.selectChatModels()
				if (models.length === 0) {
					vscode.window.showInformationMessage("No AI models available.");
					logger.trace("No AI models available.");
					return;
				}
				const quickPick = vscode.window.createQuickPick();
				quickPick.title = "Available AI Models";
				quickPick.canSelectMany = false;
				quickPick.placeholder = 'Select an AI model';
				const items: vscode.QuickPickItem[] = models.map((model) => ({
					label: model.name,
					description: `${model.family} by ${model.vendor} [v${model.version}]`,
					detail: model.id,
				})).sort((a, b) => a.label.localeCompare(b.label));
				const currentSelection = config.aiModel.toLowerCase();
				(items.find((item) => (item.label.toLowerCase() == currentSelection) || (item.detail?.toLowerCase() == currentSelection)) || items[0]).picked = true // Set the default selected item to the current model;
				quickPick.items = items;
				quickPick.onDidChangeSelection((selection) => {
					if (selection[0]) {
						logger.info("Selected AI model:", selection[0].label);
						quickPick.value = selection[0].label;
						config.aiModel = selection[0].detail;
						quickPick.hide();
						vscode.window.showInformationMessage(`AI model set to ${selection[0].label}`);
					}
				});
				quickPick.onDidHide(() => {
					quickPick.dispose()
					logger.trace("AI Selection Quick pick disposed.");
				});
				quickPick.show();
			} catch (error) {
				logger.error("Error fetching AI models:", error);
				vscode.window.showErrorMessage("Failed to fetch AI models. Please try again later.");
			}
		});
	} catch (error) {
		logger.error("Error registering commands:", error);
		throw error;
	}
}
