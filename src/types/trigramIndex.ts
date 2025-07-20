export interface TrigramItem {
    id: number;
    path: string;
    name: string;
    type: ItemType;
    parentId?: number;
    metadata?: Record<string, any>;
}

export enum ItemType {
    File = 0,
    Class = 1,
    Method = 2,
    Function = 3,
    Variable = 4,
    Interface = 5,
    Enum = 6,
    Namespace = 7
}

export interface TrigramMatch {
    trigram: string;
    itemId: number;
    position: number;
}

export interface CamelCaseToken {
    token: string;
    itemId: number;
    position: number;
}

export interface SearchResult {
    item: TrigramItem;
    score: number;
    matchedTrigrams?: string[];
    matchedTokens?: string[];
}

export interface IndexStats {
    totalItems: number;
    totalTrigrams: number;
    totalTokens: number;
    indexSizeBytes?: number;
    lastUpdated: Date;
}

export interface TrigramStorageAdapter {
    // Initialization
    initialize(): Promise<void>;
    close(): Promise<void>;
    clear(): Promise<void>;
    
    // Item management
    addItem(item: TrigramItem): Promise<number>;
    updateItem(id: number, item: Partial<TrigramItem>): Promise<void>;
    deleteItem(id: number): Promise<void>;
    getItem(id: number): Promise<TrigramItem | null>;
    getItemByPath(path: string): Promise<TrigramItem | null>;
    getAllItems(): Promise<TrigramItem[]>;
    
    // Trigram management
    addTrigrams(trigrams: TrigramMatch[]): Promise<void>;
    removeTrigrams(itemId: number): Promise<void>;
    searchTrigrams(trigrams: string[]): Promise<Map<number, number>>; // itemId -> match count
    
    // CamelCase token management
    addTokens(tokens: CamelCaseToken[]): Promise<void>;
    removeTokens(itemId: number): Promise<void>;
    searchTokens(tokens: string[]): Promise<Map<number, number>>; // itemId -> match count
    
    // Batch operations
    beginTransaction(): Promise<void>;
    commitTransaction(): Promise<void>;
    rollbackTransaction(): Promise<void>;
    
    // Statistics
    getStats(): Promise<IndexStats>;
    
    // Storage-specific optimization hints
    optimize?(): Promise<void>;
    vacuum?(): Promise<void>;
}

export interface TrigramStorageConfig {
    storagePath: string;
    inMemory?: boolean;
    cacheSize?: number;
    extensionPath?: string; // Path to extension for locating resources
    [key: string]: any; // Allow storage-specific options
}