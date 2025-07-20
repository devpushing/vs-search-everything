import * as vscode from 'vscode';

class Logger {
    private outputChannel: vscode.OutputChannel;
    private debugMode: boolean = false;

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Search Everything');
        this.updateDebugMode();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('searchEverywhere.debugMode')) {
                this.updateDebugMode();
            }
        });
    }

    private updateDebugMode(): void {
        const config = vscode.workspace.getConfiguration('searchEverywhere');
        this.debugMode = config.get<boolean>('debugMode', false);
        if (this.debugMode) {
            this.outputChannel.show();
        }
    }

    setEnabled(enabled: boolean): void {
        this.debugMode = enabled;
        if (this.debugMode) {
            this.outputChannel.show();
        }
    }

    log(message: string, ...args: any[]): void {
        if (this.debugMode) {
            const timestamp = new Date().toISOString();
            const formattedMessage = `[${timestamp}] ${message}`;
            
            // Log to console
            console.log(formattedMessage, ...args);
            
            // Log to output channel
            this.outputChannel.appendLine(formattedMessage);
            if (args.length > 0) {
                this.outputChannel.appendLine(JSON.stringify(args, null, 2));
            }
        }
    }

    error(message: string, error?: any): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] ERROR: ${message}`;
        
        // Always log errors
        console.error(formattedMessage, error);
        
        this.outputChannel.appendLine(formattedMessage);
        if (error) {
            this.outputChannel.appendLine(error.toString());
            if (error.stack) {
                this.outputChannel.appendLine(error.stack);
            }
        }
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

export const logger = new Logger();