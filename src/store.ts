import { observable } from "mobx";
import * as vscode from "vscode";

export const store = observable({
	enabled: false,
	isPulling: false,
	isPushing: false,
	isCommitting: false,
	lastCommitSuccessful: true,
	context: null,
	debugged: false,
} as {
	enabled: boolean;
	isPulling: boolean;
	isPushing: boolean;
	isCommitting: boolean;
	lastCommitSuccessful: boolean;
	context: vscode.ExtensionContext | null;
	debugged: boolean;
});
