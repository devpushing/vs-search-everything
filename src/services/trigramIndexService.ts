import * as vscode from 'vscode';
import * as path from 'path';
import {
    TrigramStorageAdapter,
    TrigramItem,
    ItemType,
    SearchResult,
    TrigramStorageConfig
} from '../types/trigramIndex';
import { TrigramUtils } from '../utils/trigramUtils';
import { SearchItem, SearchItemType } from '../types/search';
import { logger } from '../utils/logger';

export class TrigramIndexService {
    private storage: TrigramStorageAdapter;
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private updateTimer: NodeJS.Timeout | null = null;
    private pendingUpdates: Map<string, 'add' | 'update' | 'delete'> = new Map();
    private caseSensitive: boolean;
    private minTrigramLength: number;
    private enableCamelCase: boolean;

    constructor(
        private context: vscode.ExtensionContext,
        private storageAdapter: TrigramStorageAdapter
    ) {
        this.storage = storageAdapter;
        
        const config = vscode.workspace.getConfiguration('searchEverything');
        this.caseSensitive = config.get<boolean>('trigramCaseSensitive', false);
        this.minTrigramLength = config.get<number>('trigramMinLength', 3);
        this.enableCamelCase = config.get<boolean>('enableCamelCaseMatching', true);
        
        logger.log('Trigram index service created', {
            caseSensitive: this.caseSensitive,
            minTrigramLength: this.minTrigramLength,
            enableCamelCase: this.enableCamelCase
        });
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = this.performInitialization();
        await this.initPromise;
        this.isInitialized = true;
    }

    private async performInitialization(): Promise<void> {
        logger.log('Initializing trigram index service...');
        
        try {
            // Initialize storage
            await this.storage.initialize();
            
            // Check if index needs building
            const stats = await this.storage.getStats();
            if (stats.totalItems === 0) {
                logger.log('Building new trigram index...');
                await this.buildIndex();
            } else {
                logger.log('Loaded existing trigram index', stats);
            }
            
            // Set up file watchers
            this.setupFileWatchers();
            
            logger.log('Trigram index service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize trigram index service:', error);
            throw error;
        }
    }

    private async buildIndex(): Promise<void> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Search Everything",
            cancellable: true
        }, async (progress, token) => {
            const startTime = Date.now();
            
            try {
                // Disable auto-commit for bulk operations
                if ((this.storage as any).setAutoCommit) {
                    (this.storage as any).setAutoCommit(false);
                }
                
                // Start transaction
                await this.storage.beginTransaction();
                
                // Initial progress
                progress.report({ message: "Discovering files...", increment: 0 });
                logger.log('Starting to build trigram index...');
                const fileCount = await this.indexFiles(progress, token);
                
                if (token.isCancellationRequested) {
                    await this.storage.rollbackTransaction();
                    throw new Error('Indexing cancelled');
                }
                
                // Index symbols
                progress.report({ message: "Indexing symbols...", increment: 50 });
                const symbolCount = await this.indexSymbols(progress, token);
                
                if (token.isCancellationRequested) {
                    await this.storage.rollbackTransaction();
                    throw new Error('Indexing cancelled');
                }
                
                // Commit all changes
                progress.report({ message: "Committing changes..." });
                await this.storage.commitTransaction();
                
                // Re-enable auto-commit
                if ((this.storage as any).setAutoCommit) {
                    (this.storage as any).setAutoCommit(true);
                }
                
                // Optimize storage
                if (this.storage.optimize) {
                    progress.report({ message: "Optimizing index...", increment: 90 });
                    await this.storage.optimize();
                }
                
                const totalTime = Date.now() - startTime;
                const stats = await this.storage.getStats();
                
                // Save database to disk and get info
                if ((this.storage as any).saveToFile) {
                    (this.storage as any).saveToFile();
                }
                
                // Get database info
                let dbInfo: { path: string; sizeBytes?: number } | null = null;
                if ((this.storage as any).getDatabaseInfo) {
                    dbInfo = (this.storage as any).getDatabaseInfo();
                }
                
                // Get memory usage for in-memory storage
                let memoryInfo = null;
                if ((this.storage as any).getMemoryUsage) {
                    memoryInfo = (this.storage as any).getMemoryUsage();
                }
                
                logger.log('Trigram index built successfully', {
                    fileCount,
                    symbolCount,
                    totalTime: `${totalTime}ms`,
                    stats,
                    database: dbInfo ? {
                        path: dbInfo.path,
                        sizeBytes: dbInfo.sizeBytes,
                        sizeMB: dbInfo.sizeBytes ? (dbInfo.sizeBytes / 1024 / 1024).toFixed(2) + ' MB' : 'unknown'
                    } : null,
                    memory: memoryInfo ? {
                        heapUsedMB: (memoryInfo.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
                        shardInfo: memoryInfo.shardInfo,
                        stats: memoryInfo.stats
                    } : null
                });
                
                let infoMessage = `Trigram index built: ${fileCount} files, ${symbolCount} symbols in ${(totalTime / 1000).toFixed(1)}s`;
                if (dbInfo && dbInfo.sizeBytes) {
                    infoMessage += ` (${(dbInfo.sizeBytes / 1024 / 1024).toFixed(1)} MB)`;
                }
                
                vscode.window.showInformationMessage(infoMessage);
            } catch (error) {
                logger.error('Failed to build trigram index:', error);
                
                // Try to rollback if possible
                try {
                    await this.storage.rollbackTransaction();
                } catch (rollbackError) {
                    logger.log('Transaction rollback failed:', rollbackError);
                }
                
                // Re-enable auto-commit
                if ((this.storage as any).setAutoCommit) {
                    (this.storage as any).setAutoCommit(true);
                }
                
                throw error;
            }
        });
    }

    private async indexFiles(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<number> {
        const config = vscode.workspace.getConfiguration('searchEverything');
        const excludePatterns = config.get<string[]>('excludePatterns', []);
        
        // Add more default exclusions for large projects
        const defaultExclusions = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/.next/**',
            '**/out/**',
            '**/*.min.js',
            '**/*.map',
            '**/vendor/**',
            '**/bower_components/**',
            '**/tmp/**',
            '**/temp/**',
            '**/.cache/**',
            '**/.vscode/**',
            '**/.idea/**'
        ];
        
        const allExclusions = [...new Set([...excludePatterns, ...defaultExclusions])];
        
        const files = await vscode.workspace.findFiles(
            '**/*',
            `{${allExclusions.join(',')}}`
        );
        
        logger.log(`Found ${files.length} files to index`);
        let indexed = 0;
        let lastProgress = 0;
        const vsConfig = vscode.workspace.getConfiguration('searchEverything');
        const BATCH_SIZE = vsConfig.get<number>('trigramBatchSize', 10000);
        
        for (const file of files) {
            if (token.isCancellationRequested) break;
            
            const relativePath = vscode.workspace.asRelativePath(file);
            const fileName = path.basename(relativePath);
            
            // Add item to storage
            const itemId = await this.storage.addItem({
                id: 0, // Will be assigned by storage
                path: relativePath,
                name: fileName,
                type: ItemType.File
            });
            
            // Generate and store trigrams
            await this.indexItemText(itemId, `${fileName} ${relativePath}`);
            
            indexed++;
            
            // Update progress more frequently
            if (indexed % 50 === 0 || indexed === files.length) {
                const currentProgress = (indexed / files.length) * 50;
                const increment = currentProgress - lastProgress;
                lastProgress = currentProgress;
                
                progress.report({
                    message: `Indexing files: ${indexed}/${files.length}`,
                    increment: increment
                });
                
                // Log progress at 1/10th of batch size or every 1000, whichever is larger
                const logInterval = Math.max(1000, Math.floor(BATCH_SIZE / 10));
                if (indexed % logInterval === 0) {
                    logger.log(`Progress: ${indexed}/${files.length} files indexed`);
                }
                
                // Force UI update with small delay
                await new Promise(resolve => setTimeout(resolve, 1));
            }
        }
        
        return indexed;
    }

    private async indexSymbols(
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<number> {
        const vsConfig = vscode.workspace.getConfiguration('searchEverything');
        const BATCH_SIZE = vsConfig.get<number>('trigramBatchSize', 10000);
        
        try {
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                ''
            ) || [];
            
            logger.log(`Found ${symbols.length} symbols to index`);
            let indexed = 0;
            let lastProgress = 50; // Start at 50% since files are done
            
            // Group symbols by file for parent relationships
            const symbolsByFile = new Map<string, vscode.SymbolInformation[]>();
            for (const symbol of symbols) {
                const filePath = vscode.workspace.asRelativePath(symbol.location.uri);
                if (!symbolsByFile.has(filePath)) {
                    symbolsByFile.set(filePath, []);
                }
                symbolsByFile.get(filePath)!.push(symbol);
            }
            
            for (const [filePath, fileSymbols] of symbolsByFile) {
                if (token.isCancellationRequested) break;
                
                // Get or create parent file item
                let parentItem = await this.storage.getItemByPath(filePath);
                if (!parentItem) {
                    const parentId = await this.storage.addItem({
                        id: 0,
                        path: filePath,
                        name: path.basename(filePath),
                        type: ItemType.File
                    });
                    parentItem = await this.storage.getItem(parentId);
                }
                
                for (const symbol of fileSymbols) {
                    // Add symbol item
                    const itemId = await this.storage.addItem({
                        id: 0,
                        path: symbol.location.uri.fsPath,
                        name: symbol.name,
                        type: this.mapSymbolKindToItemType(symbol.kind),
                        parentId: parentItem?.id,
                        metadata: {
                            containerName: symbol.containerName,
                            range: symbol.location.range
                        }
                    });
                    
                    // Index symbol text
                    const searchText = `${symbol.name} ${symbol.containerName || ''} ${path.basename(filePath)}`;
                    await this.indexItemText(itemId, searchText);
                    
                    indexed++;
                    
                    // Update progress periodically
                    if (indexed % 50 === 0 || indexed === symbols.length) {
                        const currentProgress = 50 + (indexed / symbols.length) * 40;
                        const increment = currentProgress - lastProgress;
                        lastProgress = currentProgress;
                        
                        progress.report({
                            message: `Indexing symbols: ${indexed}/${symbols.length}`,
                            increment: increment
                        });
                        
                        // Log progress at 1/10th of batch size or every 1000, whichever is larger
                        const logInterval = Math.max(1000, Math.floor(BATCH_SIZE / 10));
                        if (indexed % logInterval === 0) {
                            logger.log(`Progress: ${indexed}/${symbols.length} symbols indexed`);
                        }
                        
                        // Force UI update
                        await new Promise(resolve => setTimeout(resolve, 1));
                    }
                }
            }
            
            return indexed;
        } catch (error) {
            logger.error('Failed to index symbols:', error);
            return 0;
        }
    }

    private async indexItemText(itemId: number, text: string): Promise<void> {
        // Preprocess text
        const processedText = TrigramUtils.preprocessForIndexing(text);
        
        // Generate trigrams
        const trigramsWithPos = TrigramUtils.generateTrigramsWithPositions(
            processedText,
            this.caseSensitive
        );
        
        if (trigramsWithPos.length > 0) {
            const trigramMatches = trigramsWithPos.map(t => ({
                trigram: t.trigram,
                itemId: itemId,
                position: t.position
            }));
            
            await this.storage.addTrigrams(trigramMatches);
        }
        
        // Generate CamelCase tokens if enabled
        if (this.enableCamelCase) {
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions(text);
            
            if (tokensWithPos.length > 0) {
                const tokenMatches = tokensWithPos.map(t => ({
                    token: this.caseSensitive ? t.token : t.token.toLowerCase(),
                    itemId: itemId,
                    position: t.position
                }));
                
                await this.storage.addTokens(tokenMatches);
            }
        }
    }

    async search(query: string, maxResults: number = 50): Promise<SearchResult[]> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        if (!query || query.trim().length === 0) {
            return [];
        }
        
        const processedQuery = query.trim();
        const results = new Map<number, SearchResult>();
        
        // Search using trigrams
        if (processedQuery.length >= this.minTrigramLength) {
            const trigrams = TrigramUtils.generateTrigrams(processedQuery, this.caseSensitive);
            if (trigrams.length > 0) {
                const trigramMatches = await this.storage.searchTrigrams(trigrams);
                
                for (const [itemId, matchCount] of trigramMatches) {
                    const item = await this.storage.getItem(itemId);
                    if (item) {
                        const score = TrigramUtils.calculateMatchScore(
                            processedQuery,
                            item.name,
                            this.caseSensitive
                        );
                        
                        if (score > 0) {
                            results.set(itemId, {
                                item,
                                score,
                                matchedTrigrams: trigrams.slice(0, matchCount)
                            });
                        }
                    }
                }
            }
        }
        
        // Search using CamelCase tokens if enabled
        if (this.enableCamelCase) {
            const tokens = TrigramUtils.extractCamelCaseTokens(processedQuery);
            if (tokens.length > 0) {
                const processedTokens = tokens.map(t => 
                    this.caseSensitive ? t : t.toLowerCase()
                );
                
                const tokenMatches = await this.storage.searchTokens(processedTokens);
                
                for (const [itemId, matchCount] of tokenMatches) {
                    if (!results.has(itemId)) {
                        const item = await this.storage.getItem(itemId);
                        if (item) {
                            const score = TrigramUtils.calculateMatchScore(
                                processedQuery,
                                item.name,
                                this.caseSensitive
                            );
                            
                            if (score > 0) {
                                results.set(itemId, {
                                    item,
                                    score: score + 100, // Boost CamelCase matches
                                    matchedTokens: tokens.slice(0, matchCount)
                                });
                            }
                        }
                    }
                }
            }
            
            // Also check for abbreviation matches
            const allItems = await this.storage.getAllItems();
            for (const item of allItems) {
                if (!results.has(item.id) && TrigramUtils.matchesAbbreviation(processedQuery, item.name)) {
                    results.set(item.id, {
                        item,
                        score: 600, // Good score for abbreviation matches
                        matchedTokens: [processedQuery]
                    });
                }
            }
        }
        
        // Sort by score and return top results
        const sortedResults = Array.from(results.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, maxResults);
        
        logger.log(`Trigram search for "${query}" returned ${sortedResults.length} results`);
        
        return sortedResults;
    }

    async searchAsQuickPickItems(query: string, maxResults: number = 50): Promise<SearchItem[]> {
        const searchResults = await this.search(query, maxResults);
        
        return searchResults.map(result => {
            const item = result.item;
            const type = this.mapItemTypeToSearchType(item.type);
            
            let label = item.name;
            let description = item.path;
            
            // Add icon for symbols
            if (item.type !== ItemType.File) {
                label = `$(symbol-${type}) ${item.name}`;
                description = `${path.basename(item.path)} • ${this.getItemTypeLabel(item.type)}`;
                
                if (item.metadata?.containerName) {
                    description = `${item.metadata.containerName} • ${description}`;
                }
            } else {
                description = `${item.path} • File`;
            }
            
            const uri = vscode.Uri.file(
                path.isAbsolute(item.path) 
                    ? item.path 
                    : path.join(vscode.workspace.rootPath || '', item.path)
            );
            
            return {
                label,
                description,
                detail: undefined,
                type,
                uri,
                range: item.metadata?.range,
                alwaysShow: true,
                score: result.score
            };
        });
    }

    private setupFileWatchers(): void {
        logger.log('Setting up file watchers for trigram index...');
        
        const config = vscode.workspace.getConfiguration('searchEverything');
        const excludePatterns = config.get<string[]>('excludePatterns', []);
        
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        this.fileWatcher.onDidCreate(uri => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            if (!this.shouldExclude(relativePath, excludePatterns)) {
                this.scheduleBatchUpdate(relativePath, 'add');
            }
        });
        
        this.fileWatcher.onDidChange(uri => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            if (!this.shouldExclude(relativePath, excludePatterns)) {
                this.scheduleBatchUpdate(relativePath, 'update');
            }
        });
        
        this.fileWatcher.onDidDelete(uri => {
            const relativePath = vscode.workspace.asRelativePath(uri);
            this.scheduleBatchUpdate(relativePath, 'delete');
        });
    }

    private shouldExclude(relativePath: string, patterns: string[]): boolean {
        for (const pattern of patterns) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
            if (regex.test(relativePath)) {
                return true;
            }
        }
        return false;
    }

    private scheduleBatchUpdate(path: string, operation: 'add' | 'update' | 'delete'): void {
        this.pendingUpdates.set(path, operation);
        
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        
        this.updateTimer = setTimeout(() => {
            this.processPendingUpdates();
        }, 1000);
    }

    private async processPendingUpdates(): Promise<void> {
        const updates = new Map(this.pendingUpdates);
        this.pendingUpdates.clear();
        
        logger.log(`Processing ${updates.size} pending updates`);
        
        try {
            await this.storage.beginTransaction();
            
            for (const [filePath, operation] of updates) {
                switch (operation) {
                    case 'add':
                        await this.addFileToIndex(filePath);
                        break;
                    case 'update':
                        await this.updateFileInIndex(filePath);
                        break;
                    case 'delete':
                        await this.deleteFileFromIndex(filePath);
                        break;
                }
            }
            
            await this.storage.commitTransaction();
        } catch (error) {
            logger.error('Failed to process updates:', error);
            await this.storage.rollbackTransaction();
        }
    }

    private async addFileToIndex(filePath: string): Promise<void> {
        // Check if file already exists
        const existing = await this.storage.getItemByPath(filePath);
        if (existing) {
            // File already exists, update it instead
            await this.updateFileInIndex(filePath);
            return;
        }
        
        const fileName = path.basename(filePath);
        
        const itemId = await this.storage.addItem({
            id: 0,
            path: filePath,
            name: fileName,
            type: ItemType.File
        });
        
        await this.indexItemText(itemId, `${fileName} ${filePath}`);
    }

    private async updateFileInIndex(filePath: string): Promise<void> {
        const existing = await this.storage.getItemByPath(filePath);
        if (existing) {
            // Remove old trigrams and tokens
            await this.storage.removeTrigrams(existing.id);
            await this.storage.removeTokens(existing.id);
            
            // Re-index
            await this.indexItemText(existing.id, `${existing.name} ${filePath}`);
        } else {
            // File doesn't exist, add it
            await this.addFileToIndex(filePath);
        }
    }

    private async deleteFileFromIndex(filePath: string): Promise<void> {
        const existing = await this.storage.getItemByPath(filePath);
        if (existing) {
            await this.storage.deleteItem(existing.id);
        }
    }

    async refreshIndex(): Promise<void> {
        logger.log('Refreshing trigram index...');
        
        // Ensure storage is initialized before clearing
        if (!this.isInitialized) {
            await this.initialize();
        }
        
        // Clear existing indices
        await this.storage.clear();
        
        // Reset initialization state
        this.isInitialized = false;
        this.initPromise = null;
        
        // Rebuild index
        await this.buildIndex();
        
        this.isInitialized = true;
    }

    private mapSymbolKindToItemType(kind: vscode.SymbolKind): ItemType {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return ItemType.Class;
            case vscode.SymbolKind.Method:
                return ItemType.Method;
            case vscode.SymbolKind.Function:
                return ItemType.Function;
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Constant:
                return ItemType.Variable;
            case vscode.SymbolKind.Interface:
                return ItemType.Interface;
            case vscode.SymbolKind.Enum:
                return ItemType.Enum;
            case vscode.SymbolKind.Namespace:
            case vscode.SymbolKind.Module:
                return ItemType.Namespace;
            default:
                return ItemType.Variable;
        }
    }

    private mapItemTypeToSearchType(type: ItemType): SearchItemType {
        switch (type) {
            case ItemType.File:
                return SearchItemType.File;
            case ItemType.Class:
                return SearchItemType.Class;
            case ItemType.Method:
                return SearchItemType.Method;
            case ItemType.Function:
                return SearchItemType.Function;
            case ItemType.Variable:
                return SearchItemType.Variable;
            case ItemType.Interface:
                return SearchItemType.Interface;
            case ItemType.Enum:
                return SearchItemType.Enum;
            case ItemType.Namespace:
                return SearchItemType.Namespace;
            default:
                return SearchItemType.Variable;
        }
    }

    private getItemTypeLabel(type: ItemType): string {
        switch (type) {
            case ItemType.File:
                return 'File';
            case ItemType.Class:
                return 'Class';
            case ItemType.Method:
                return 'Method';
            case ItemType.Function:
                return 'Function';
            case ItemType.Variable:
                return 'Variable';
            case ItemType.Interface:
                return 'Interface';
            case ItemType.Enum:
                return 'Enum';
            case ItemType.Namespace:
                return 'Namespace';
            default:
                return 'Symbol';
        }
    }

    dispose(): void {
        logger.log('Disposing trigram index service...');
        
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
        
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
        
        this.storage.close();
        
        logger.log('Trigram index service disposed');
    }
}