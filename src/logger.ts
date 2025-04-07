import * as vscode from "vscode";
import * as winston from "winston";
import * as winstonTransportVscode from "winston-transport-vscode";
import { EXTENSION_LOG_FMT, EXTENSION_NAME } from "./constants";
import { store } from "./store";
import Transport = require('winston-transport');
import util = require('util');

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
        let debugger_attached = store.context?.environmentVariableCollection.get("vscode.ExtensionContext");
        if (debugger_attached) {
            if (debugger_attached.value.length > 0) {
                store.debugged = true;
            }
        }
        // 2. Create a Log Output Channel for your extension with the VS Code API
        const outputChannel = vscode.window.createOutputChannel(EXTENSION_NAME, {
            log: true,
        });

        // 3. Create the Winston logger giving it the Log Output Channel
        const internaL_logger = winston.createLogger({
            level: "trace", // Recommended: set the highest possible level
            levels: winstonTransportVscode.LogOutputChannelTransport.config.levels, // Recommended: use predefined VS Code log levels
            format: winstonTransportVscode.LogOutputChannelTransport.format(), // Recommended: use predefined format
            // @ts-ignore
            transports: store.debugged ? [new winstonTransportVscode.LogOutputChannelTransport(
                {
                    outputChannel
                }
            )
            ] : [
                new winston.transports.Console(
                    {
                        forceConsole: true,
                        level: "trace",
                        consoleWarnLevels: ["warn"],
                        stderrLevels: ["error"],
                        format: winston.format.combine(
                            winston.format.colorize(
                                {
                                    all: true,
                                    colors: {
                                        error: "red",
                                        warn: "yellow",
                                        info: "green",
                                        debug: "blue",
                                        trace: "magenta"
                                    }
                                }
                            ),
                            winston.format.prettyPrint(
                                {
                                    colorize: true,
                                    depth: 3,

                                }
                            ),
                            winston.format.timestamp(
                                {
                                    format: "YYYY-MM-DD HH:mm:ss.SSS"
                                }
                            ),
                            winston.format.errors(
                                {
                                    stack: true
                                }
                            ),
                            winston.format.printf(
                                (info) => {
                                    return `${info.timestamp} ${info.level}: ${info.message}`;
                                }
                            )
                        )
                    }
                ),
                new winstonTransportVscode.LogOutputChannelTransport(
                    {
                        outputChannel
                    }
                )
            ],

        })// Create a logger instance with the output channel


        const logger = new Logger(internaL_logger, vscode.workspace.getConfiguration("gitdoc").get("fullTrace", false));

        return logger;
    }
    catch (error) {
        console.error(EXTENSION_LOG_FMT, "Error creating logger:", error);
        throw error;
    }
}


/*
//
// Inherit from `winston-transport` so you can take advantage
// of the base functionality and `.exceptions.handle()`.
//
module.exports = class YourCustomTransport extends Transport {
    constructor(opts) {
        super(opts);
        //
        // Consume any custom options here. e.g.:
        // - Connection information for databases
        // - Authentication information for APIs (e.g. loggly, papertrail,
        //   logentries, etc.).
        //
    }

    log(info, callback) {
        setImmediate(() => {
            this.emit('logged', info);
        });

        // Perform the writing to the remote service
        callback();
    }
}; */