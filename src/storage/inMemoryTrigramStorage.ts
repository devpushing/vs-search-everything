import * as vscode from 'vscode';
import {
    TrigramStorageAdapter,
    TrigramItem,
    ItemType,
    TrigramMatch,
    CamelCaseToken,
    SearchResult,
    IndexStats,
    TrigramStorageConfig
} from '../types/trigramIndex';
import { logger } from '../utils/logger';

/**
 * In-memory trigram storage using array-based sharding to bypass
 * JavaScript's Map limit of 16.7 million entries.
 * 
 * Uses a two-level structure:
 * - First level: Array with 65,536 slots (indexed by first 2 chars)
 * - Second level: Map for each shard
 */
export class InMemoryTrigramStorage implements TrigramStorageAdapter {
    // Item storage
    private itemsById: Map<number, TrigramItem> = new Map();
    private itemsByPath: Map<string, TrigramItem> = new Map();
    
    // Trigram sharding: Array[65536] -> Map<trigram, Set<itemId>>
    private trigramShards: (Map<string, Set<number>> | undefined)[] = new Array(65536);
    
    // Token sharding: Array[256] -> Map<token, Set<itemId>>
    private tokenShards: (Map<string, Set<number>> | undefined)[] = new Array(256);
    
    // Statistics
    private totalTrigrams = 0;
    private totalTokens = 0;
    private activeTrigramShards = 0;
    private activeTokenShards = 0;
    
    private nextId = 1;
    private config: TrigramStorageConfig;

    constructor(config: TrigramStorageConfig) {
        this.config = config;
        logger.log('In-memory trigram storage initialized');
    }

    async initialize(): Promise<void> {
        // No initialization needed for in-memory storage
        logger.log('In-memory storage ready');
    }

    async close(): Promise<void> {
        // Clear all data
        this.clear();
    }

    async clear(): Promise<void> {
        this.itemsById.clear();
        this.itemsByPath.clear();
        this.trigramShards = new Array(65536);
        this.tokenShards = new Array(256);
        this.totalTrigrams = 0;
        this.totalTokens = 0;
        this.activeTrigramShards = 0;
        this.activeTokenShards = 0;
        this.nextId = 1;
        logger.log('In-memory storage cleared');
    }

    // Helper methods for shard indexing
    private getTrigramShardIndex(trigram: string): number {
        // Convert first 2 characters to 16-bit index
        const c1 = trigram.charCodeAt(0) || 0;
        const c2 = trigram.charCodeAt(1) || 0;
        return (c1 << 8) | c2;
    }

    private getTokenShardIndex(token: string): number {
        // Convert first character to 8-bit index
        return token.charCodeAt(0) || 0;
    }

    private getTrigramShard(index: number): Map<string, Set<number>> {
        if (!this.trigramShards[index]) {
            this.trigramShards[index] = new Map();
            this.activeTrigramShards++;
        }
        return this.trigramShards[index]!;
    }

    private getTokenShard(index: number): Map<string, Set<number>> {
        if (!this.tokenShards[index]) {
            this.tokenShards[index] = new Map();
            this.activeTokenShards++;
        }
        return this.tokenShards[index]!;
    }

    // Item management
    async addItem(item: TrigramItem): Promise<number> {
        const id = this.nextId++;
        const itemWithId = { ...item, id };
        
        this.itemsById.set(id, itemWithId);
        this.itemsByPath.set(item.path, itemWithId);
        
        return id;
    }

    async updateItem(id: number, item: Partial<TrigramItem>): Promise<void> {
        const existing = this.itemsById.get(id);
        if (!existing) {
            throw new Error(`Item with id ${id} not found`);
        }
        
        const updated = { ...existing, ...item };
        this.itemsById.set(id, updated);
        
        // Update path index if path changed
        if (item.path && item.path !== existing.path) {
            this.itemsByPath.delete(existing.path);
            this.itemsByPath.set(item.path, updated);
        }
    }

    async deleteItem(id: number): Promise<void> {
        const item = this.itemsById.get(id);
        if (!item) return;
        
        this.itemsById.delete(id);
        this.itemsByPath.delete(item.path);
        
        // Remove from trigram index
        await this.removeTrigrams(id);
        await this.removeTokens(id);
    }

    async getItem(id: number): Promise<TrigramItem | null> {
        return this.itemsById.get(id) || null;
    }

    async getItemByPath(path: string): Promise<TrigramItem | null> {
        return this.itemsByPath.get(path) || null;
    }

    async getItemsByType(type: ItemType): Promise<TrigramItem[]> {
        const items: TrigramItem[] = [];
        for (const item of this.itemsById.values()) {
            if (item.type === type) {
                items.push(item);
            }
        }
        return items;
    }

    async getChildItems(parentId: number): Promise<TrigramItem[]> {
        const items: TrigramItem[] = [];
        for (const item of this.itemsById.values()) {
            if (item.parentId === parentId) {
                items.push(item);
            }
        }
        return items;
    }

    async getAllItems(): Promise<TrigramItem[]> {
        return Array.from(this.itemsById.values());
    }

    // Trigram management
    async addTrigrams(trigrams: TrigramMatch[]): Promise<void> {
        for (const { trigram, itemId } of trigrams) {
            const shardIndex = this.getTrigramShardIndex(trigram);
            const shard = this.getTrigramShard(shardIndex);
            
            let itemSet = shard.get(trigram);
            if (!itemSet) {
                itemSet = new Set();
                shard.set(trigram, itemSet);
                this.totalTrigrams++;
            }
            itemSet.add(itemId);
        }
    }

    async removeTrigrams(itemId: number): Promise<void> {
        // Iterate through all shards to remove item references
        for (let i = 0; i < this.trigramShards.length; i++) {
            const shard = this.trigramShards[i];
            if (!shard) continue;
            
            for (const [trigram, itemSet] of shard) {
                itemSet.delete(itemId);
                if (itemSet.size === 0) {
                    shard.delete(trigram);
                    this.totalTrigrams--;
                }
            }
            
            // Clean up empty shards
            if (shard.size === 0) {
                this.trigramShards[i] = undefined;
                this.activeTrigramShards--;
            }
        }
    }

    async searchTrigrams(trigrams: string[]): Promise<Map<number, number>> {
        const scores = new Map<number, number>();
        
        for (const trigram of trigrams) {
            const shardIndex = this.getTrigramShardIndex(trigram);
            const shard = this.trigramShards[shardIndex];
            if (!shard) continue;
            
            const itemSet = shard.get(trigram);
            if (!itemSet) continue;
            
            for (const itemId of itemSet) {
                scores.set(itemId, (scores.get(itemId) || 0) + 1);
            }
        }
        
        return scores;
    }

    // Token management
    async addTokens(tokens: CamelCaseToken[]): Promise<void> {
        for (const { token, itemId } of tokens) {
            const shardIndex = this.getTokenShardIndex(token);
            const shard = this.getTokenShard(shardIndex);
            
            let itemSet = shard.get(token);
            if (!itemSet) {
                itemSet = new Set();
                shard.set(token, itemSet);
                this.totalTokens++;
            }
            itemSet.add(itemId);
        }
    }

    async removeTokens(itemId: number): Promise<void> {
        // Iterate through all token shards to remove item references
        for (let i = 0; i < this.tokenShards.length; i++) {
            const shard = this.tokenShards[i];
            if (!shard) continue;
            
            for (const [token, itemSet] of shard) {
                itemSet.delete(itemId);
                if (itemSet.size === 0) {
                    shard.delete(token);
                    this.totalTokens--;
                }
            }
            
            // Clean up empty shards
            if (shard.size === 0) {
                this.tokenShards[i] = undefined;
                this.activeTokenShards--;
            }
        }
    }

    async searchTokens(tokens: string[]): Promise<Map<number, number>> {
        const scores = new Map<number, number>();
        
        for (const token of tokens) {
            const shardIndex = this.getTokenShardIndex(token);
            const shard = this.tokenShards[shardIndex];
            if (!shard) continue;
            
            const itemSet = shard.get(token);
            if (!itemSet) continue;
            
            for (const itemId of itemSet) {
                scores.set(itemId, (scores.get(itemId) || 0) + 1);
            }
        }
        
        return scores;
    }

    // Transaction stubs (not needed for in-memory)
    async beginTransaction(): Promise<void> {
        // No-op for in-memory storage
    }

    async commitTransaction(): Promise<void> {
        // No-op for in-memory storage
    }

    async rollbackTransaction(): Promise<void> {
        // No-op for in-memory storage
    }

    // Statistics
    async getStats(): Promise<IndexStats> {
        // Calculate total trigram entries across all shards
        let totalTrigramEntries = 0;
        for (const shard of this.trigramShards) {
            if (shard) {
                for (const itemSet of shard.values()) {
                    totalTrigramEntries += itemSet.size;
                }
            }
        }

        // Calculate total token entries across all shards
        let totalTokenEntries = 0;
        for (const shard of this.tokenShards) {
            if (shard) {
                for (const itemSet of shard.values()) {
                    totalTokenEntries += itemSet.size;
                }
            }
        }

        return {
            totalItems: this.itemsById.size,
            totalTrigrams: totalTrigramEntries,
            totalTokens: totalTokenEntries,
            lastUpdated: new Date()
        };
    }

    // Storage optimization (no-op for in-memory)
    async optimize(): Promise<void> {
        // Could implement memory compaction here if needed
        logger.log('In-memory storage optimized (no-op)');
    }

    async vacuum(): Promise<void> {
        // No-op for in-memory storage
    }

    // Memory-specific methods
    getMemoryUsage(): { heapUsed: number; external: number; shardInfo: any; stats: any } {
        const memUsage = process.memoryUsage();
        
        return {
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
            shardInfo: {
                trigramShards: {
                    active: this.activeTrigramShards,
                    total: 65536,
                    usage: `${((this.activeTrigramShards / 65536) * 100).toFixed(2)}%`
                },
                tokenShards: {
                    active: this.activeTokenShards,
                    total: 256,
                    usage: `${((this.activeTokenShards / 256) * 100).toFixed(2)}%`
                }
            },
            stats: {
                items: this.itemsById.size,
                uniqueTrigrams: this.totalTrigrams,
                uniqueTokens: this.totalTokens
            }
        };
    }
}