import * as vscode from 'vscode';
import { FileSearchProvider } from '../providers/fileSearchProvider';
import { SymbolSearchProvider } from '../providers/symbolSearchProvider';
import { SearchItem, SearchItemType } from '../types/search';
import { TrigramIndexService } from '../services/trigramIndexService';
import { SqliteTrigramStorage } from '../storage/sqliteTrigramStorage';
import { InMemoryTrigramStorage } from '../storage/inMemoryTrigramStorage';
import { TrigramStorageConfig, TrigramStorageAdapter } from '../types/trigramIndex';
import { debounce } from '../utils/debounce';
import * as path from 'path';

export class SearchCommand {
    private fileSearchProvider: FileSearchProvider;
    private symbolSearchProvider: SymbolSearchProvider;
    private trigramIndexService: TrigramIndexService;
    private quickPick: vscode.QuickPick<SearchItem> | undefined;
    private searchHistory: string[] = [];
    private debouncedSearch: (query: string) => void;
    private initializationPromise: Promise<void> | null = null;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('searchEverything');
        const excludePatterns = config.get<string[]>('excludePatterns') || [];
        const debounceDelay = config.get<number>('debounceDelay', 300);
        
        // Initialize trigram service with selected storage type
        const storageType = config.get<string>('storageType', 'sqlite');
        const storagePath = config.get<string>('trigramStoragePath') || 
            path.join(context.globalStorageUri.fsPath, 'trigram-index.db');
        
        const storageConfig: TrigramStorageConfig = {
            storagePath,
            inMemory: storageType === 'memory',
            extensionPath: context.extensionPath
        };
        
        let storage: TrigramStorageAdapter;
        if (storageType === 'memory') {
            storage = new InMemoryTrigramStorage(storageConfig);
            vscode.window.showInformationMessage('Using in-memory storage (volatile, faster)');
        } else {
            storage = new SqliteTrigramStorage(storageConfig);
        }
        this.trigramIndexService = new TrigramIndexService(context, storage);
        
        this.fileSearchProvider = new FileSearchProvider(excludePatterns);
        this.symbolSearchProvider = new SymbolSearchProvider();
        
        // Create debounced search function
        this.debouncedSearch = debounce(
            (query: string) => this.performSearch(query),
            debounceDelay
        );
        
        // Load search history
        this.searchHistory = context.globalState.get('searchHistory', []);
        
        // Initialize the selected service in the background
        this.initializeService();
    }
    
    private async initializeService(): Promise<void> {
        if (this.initializationPromise) return this.initializationPromise;
        
        this.initializationPromise = (async () => {
            try {
                await this.trigramIndexService.initialize();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize search index: ${error}`);
                throw error;
            }
        })();
        
        return this.initializationPromise;
    }

    async execute(): Promise<void> {
        this.quickPick = vscode.window.createQuickPick<SearchItem>();
        this.quickPick.placeholder = 'Search for files and symbols...';
        this.quickPick.matchOnDescription = true;
        this.quickPick.matchOnDetail = true;
        this.quickPick.canSelectMany = false;

        // Set up event handlers
        this.quickPick.onDidChangeValue(this.onSearchQueryChanged.bind(this));
        this.quickPick.onDidAccept(this.onItemSelected.bind(this));
        this.quickPick.onDidHide(() => {
            this.quickPick?.dispose();
            this.quickPick = undefined;
        });

        // Show the quick pick
        this.quickPick.show();

        // Load initial results if there's a history
        if (this.searchHistory.length > 0) {
            this.quickPick.value = '';
            await this.performSearch('');
        }
    }

    private async onSearchQueryChanged(query: string): Promise<void> {
        if (!this.quickPick) return;

        this.quickPick.busy = true;
        this.debouncedSearch(query);
    }

    private async performSearch(query: string): Promise<void> {
        if (!this.quickPick) return;

        try {
            // Ensure service is initialized
            await this.initializeService();
            const config = vscode.workspace.getConfiguration('searchEverything');
            const includeFiles = config.get<boolean>('includeFiles', true);
            const includeSymbols = config.get<boolean>('includeSymbols', true);
            const maxResults = config.get<number>('maxResults', 50);

            let fileResults: SearchItem[] = [];
            let symbolResults: SearchItem[] = [];

            if (query.length > 0) {
                // Use trigram search
                const trigramResults = await this.trigramIndexService.searchAsQuickPickItems(query, maxResults);
                
                // Separate files and symbols
                for (const item of trigramResults) {
                    if (item.type === SearchItemType.File) {
                        if (includeFiles) fileResults.push(item);
                    } else {
                        if (includeSymbols) symbolResults.push(item);
                    }
                }
            } else {
                // Fall back to traditional search for empty queries or when semantic search is disabled
                const promises: Promise<SearchItem[]>[] = [];
                
                if (includeFiles) {
                    promises.push(this.fileSearchProvider.search(query));
                }
                
                if (includeSymbols && query.length > 0) {
                    promises.push(this.symbolSearchProvider.search(query));
                }

                const searchResults = await Promise.all(promises);
                
                if (includeFiles && searchResults.length > 0) {
                    fileResults = searchResults[0];
                }
                
                if (includeSymbols && searchResults.length > 1) {
                    symbolResults = searchResults[1];
                }
            }

            // Combine results
            const results: SearchItem[] = [];
            results.push(...fileResults);
            results.push(...symbolResults);

            // Group results by type
            const groupedResults = this.groupResults(results);
            
            // Flatten grouped results with separators
            const finalResults: SearchItem[] = [];
            let addedTypes = 0;

            for (const [type, items] of groupedResults) {
                if (items.length === 0) continue;
                
                if (addedTypes > 0) {
                    // Add separator
                    finalResults.push({
                        label: '',
                        kind: vscode.QuickPickItemKind.Separator,
                        type: SearchItemType.File,
                        uri: vscode.Uri.file('')
                    });
                }

                finalResults.push(...items.slice(0, Math.ceil(maxResults / groupedResults.size)));
                addedTypes++;
            }

            this.quickPick.items = finalResults.slice(0, maxResults);
        } finally {
            if (this.quickPick) {
                this.quickPick.busy = false;
            }
        }
    }

    private groupResults(results: SearchItem[]): Map<string, SearchItem[]> {
        const groups = new Map<string, SearchItem[]>();
        
        // Initialize groups
        groups.set('Files', []);
        groups.set('Symbols', []);

        for (const item of results) {
            if (item.type === SearchItemType.File) {
                groups.get('Files')!.push(item);
            } else {
                groups.get('Symbols')!.push(item);
            }
        }

        return groups;
    }

    private async onItemSelected(): Promise<void> {
        const selection = this.quickPick?.selectedItems[0];
        if (!selection) return;

        // Save to history
        const query = this.quickPick?.value;
        if (query && query.length > 0) {
            this.searchHistory = [query, ...this.searchHistory.filter(h => h !== query)].slice(0, 10);
            await this.context.globalState.update('searchHistory', this.searchHistory);
        }

        // Hide the quick pick
        this.quickPick?.hide();

        // Open the selected item
        if (selection.type === SearchItemType.File) {
            await vscode.window.showTextDocument(selection.uri);
        } else {
            const document = await vscode.workspace.openTextDocument(selection.uri);
            const editor = await vscode.window.showTextDocument(document);
            
            if (selection.range) {
                editor.selection = new vscode.Selection(selection.range.start, selection.range.end);
                editor.revealRange(selection.range, vscode.TextEditorRevealType.InCenter);
            }
        }
    }
    
    async refreshIndex(): Promise<void> {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Refreshing search index...",
            cancellable: false
        }, async () => {
            await this.trigramIndexService.refreshIndex();
            vscode.window.showInformationMessage('Search index refreshed successfully');
        });
    }
    
    dispose(): void {
        this.trigramIndexService.dispose();
    }
}