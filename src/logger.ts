import * as vscode from "vscode";
import * as winston from "winston";
import * as windowsTransportVscode from "winston-transport-vscode";


export const logger = createLogger();

export function createLogger() {
    try {
        // 2. Create a Log Output Channel for your extension with the VS Code API
        const outputChannel = vscode.window.createOutputChannel('EXTENSION_NAME', {
            log: true,
        });

        // 3. Create the Winston logger giving it the Log Output Channel
        const logger = winston.createLogger({
            level: 'trace', // Recommended: set the highest possible level
            levels: windowsTransportVscode.LogOutputChannelTransport.config.levels, // Recommended: use predefined VS Code log levels
            format: windowsTransportVscode.LogOutputChannelTransport.format(), // Recommended: use predefined format
            transports: [new windowsTransportVscode.LogOutputChannelTransport({ outputChannel })],
        });

        return logger;
    }
    catch (error) {
        console.error("Error creating logger:", error);
        throw error;
    }
}
