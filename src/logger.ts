import * as vscode from "vscode";
import * as winston from "winston";
import * as windowsTransportVscode from "winston-transport-vscode";
import { EXTENSION_LOG_FMT, EXTENSION_NAME } from "./constants";

class Logger {
    private logger: winston.Logger;
    private is_trace: boolean = false;

    constructor(logger: winston.Logger, is_trace?: boolean) {
        this.logger = logger;
        this.is_trace = is_trace || false;
    }

    debug(...args: any[]) {
        this.logger.debug(args);
    }

    info(...args: any[]) {
        this.logger.info(args);
    }

    warn(...args: any[]) {
        this.logger.warn(args);
    }

    error(...args: any[]) {
        this.logger.error(args);
    }
    trace(...args: any[]) {
        if (this.is_trace) {
            this.logger.debug(args);
        }
    }
    update_is_trace(is_trace: boolean) {
        this.is_trace = is_trace;
    }
}

export const logger = createLogger();

export function createLogger() {
    try {
        // 2. Create a Log Output Channel for your extension with the VS Code API
        const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME, {
            log: true,
        });

        // 3. Create the Winston logger giving it the Log Output Channel
        const internaL_logger = winston.createLogger({
            level: "trace", // Recommended: set the highest possible level
            levels: windowsTransportVscode.LogOutputChannelTransport.config.levels, // Recommended: use predefined VS Code log levels
            format: windowsTransportVscode.LogOutputChannelTransport.format(), // Recommended: use predefined format
            // @ts-ignore
            transports: [new windowsTransportVscode.LogOutputChannelTransport({ outputChannel })],
        })// Create a logger instance with the output channel


        const logger = new Logger(internaL_logger, vscode.workspace.getConfiguration("gitdoc").get("fullTrace", false));

        return logger;
    }
    catch (error) {
        console.error(EXTENSION_LOG_FMT, "Error creating logger:", error);
        throw error;
    }
}
