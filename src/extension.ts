import * as vscode from 'vscode';
import { SearchCommand } from './commands/searchCommand';
import { logger } from './utils/logger';

let searchCommand: SearchCommand | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Search Everything extension is now active!');
    
    // Enable debug logging if configured
    const config = vscode.workspace.getConfiguration('searchEverywhere');
    if (config.get<boolean>('debugMode', false)) {
        logger.setEnabled(true);
    }
    
    searchCommand = new SearchCommand(context);
    
    const searchDisposable = vscode.commands.registerCommand(
        'searchEverywhere.search',
        () => searchCommand?.execute()
    );
    
    const refreshDisposable = vscode.commands.registerCommand(
        'searchEverywhere.refreshIndex',
        () => searchCommand?.refreshIndex()
    );
    
    // Watch for debug mode changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('searchEverywhere.debugMode')) {
            const newConfig = vscode.workspace.getConfiguration('searchEverywhere');
            logger.setEnabled(newConfig.get<boolean>('debugMode', false));
        }
    });

    context.subscriptions.push(searchDisposable, refreshDisposable, configChangeListener);
}

export function deactivate() {
    if (searchCommand) {
        searchCommand.dispose();
        searchCommand = undefined;
    }
    
    logger.log('Search Everything extension deactivated');
}