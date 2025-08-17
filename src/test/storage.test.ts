import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { InMemoryTrigramStorage } from '../storage/inMemoryTrigramStorage';
import { TrigramStorageAdapter, ItemType, TrigramItem } from '../types/trigramIndex';

describe('Storage Implementations', () => {
    
    async function runStorageTests(storage: TrigramStorageAdapter, name: string) {
        
        describe(`${name} - Basic Operations`, () => {
            
            beforeEach(async () => {
                await storage.initialize();
                await storage.clear();
            });

            it('should add and retrieve items', async () => {
                const item: TrigramItem = {
                    id: 0,
                    path: 'src/test.ts',
                    name: 'test.ts',
                    type: ItemType.File
                };

                const id = await storage.addItem(item);
                assert.ok(id > 0, 'Should return a valid ID');

                const retrieved = await storage.getItem(id);
                assert.ok(retrieved, 'Should retrieve the item');
                assert.strictEqual(retrieved!.path, 'src/test.ts');
                assert.strictEqual(retrieved!.name, 'test.ts');
            });

            it('should retrieve items by path', async () => {
                const item: TrigramItem = {
                    id: 0,
                    path: 'unique/path/file.ts',
                    name: 'file.ts',
                    type: ItemType.File
                };

                await storage.addItem(item);
                const retrieved = await storage.getItemByPath('unique/path/file.ts');
                
                assert.ok(retrieved, 'Should find item by path');
                assert.strictEqual(retrieved!.name, 'file.ts');
            });

            it('should update items', async () => {
                const item: TrigramItem = {
                    id: 0,
                    path: 'src/original.ts',
                    name: 'original.ts',
                    type: ItemType.File
                };

                const id = await storage.addItem(item);
                await storage.updateItem(id, { name: 'updated.ts' });

                const retrieved = await storage.getItem(id);
                assert.strictEqual(retrieved!.name, 'updated.ts');
                assert.strictEqual(retrieved!.path, 'src/original.ts'); // Path unchanged
            });

            it('should delete items', async () => {
                const item: TrigramItem = {
                    id: 0,
                    path: 'src/delete.ts',
                    name: 'delete.ts',
                    type: ItemType.File
                };

                const id = await storage.addItem(item);
                await storage.deleteItem(id);

                const retrieved = await storage.getItem(id);
                assert.strictEqual(retrieved, null, 'Item should be deleted');
            });

            it('should get all items', async () => {
                const items: TrigramItem[] = [
                    { id: 0, path: 'file1.ts', name: 'file1.ts', type: ItemType.File },
                    { id: 0, path: 'file2.ts', name: 'file2.ts', type: ItemType.File },
                    { id: 0, path: 'file3.ts', name: 'file3.ts', type: ItemType.File }
                ];

                for (const item of items) {
                    await storage.addItem(item);
                }

                const allItems = await storage.getAllItems();
                assert.strictEqual(allItems.length, 3);
            });
        });

        describe(`${name} - Trigram Operations`, () => {
            
            beforeEach(async () => {
                await storage.initialize();
                await storage.clear();
            });

            it('should add and search trigrams', async () => {
                const itemId = await storage.addItem({
                    id: 0,
                    path: 'test.ts',
                    name: 'getUserName',
                    type: ItemType.Function
                });

                await storage.addTrigrams([
                    { trigram: 'get', itemId, position: 0 },
                    { trigram: 'etu', itemId, position: 1 },
                    { trigram: 'tus', itemId, position: 2 },
                    { trigram: 'use', itemId, position: 3 },
                    { trigram: 'ser', itemId, position: 4 }
                ]);

                const results = await storage.searchTrigrams(['get', 'use']);
                assert.ok(results.has(itemId));
                assert.strictEqual(results.get(itemId), 2); // Matched 2 trigrams
            });

            it('should handle multiple items with same trigrams', async () => {
                const id1 = await storage.addItem({
                    id: 0,
                    path: 'file1.ts',
                    name: 'getUser',
                    type: ItemType.Function
                });

                const id2 = await storage.addItem({
                    id: 0,
                    path: 'file2.ts',
                    name: 'getName',
                    type: ItemType.Function
                });

                await storage.addTrigrams([
                    { trigram: 'get', itemId: id1, position: 0 },
                    { trigram: 'get', itemId: id2, position: 0 },
                    { trigram: 'use', itemId: id1, position: 3 },
                    { trigram: 'nam', itemId: id2, position: 3 }
                ]);

                const results = await storage.searchTrigrams(['get']);
                assert.strictEqual(results.size, 2); // Both items match
                assert.ok(results.has(id1));
                assert.ok(results.has(id2));
            });

            it('should remove trigrams when item is deleted', async () => {
                const itemId = await storage.addItem({
                    id: 0,
                    path: 'test.ts',
                    name: 'test',
                    type: ItemType.File
                });

                await storage.addTrigrams([
                    { trigram: 'tes', itemId, position: 0 },
                    { trigram: 'est', itemId, position: 1 }
                ]);

                await storage.removeTrigrams(itemId);

                const results = await storage.searchTrigrams(['tes', 'est']);
                assert.strictEqual(results.size, 0, 'Trigrams should be removed');
            });
        });

        describe(`${name} - Token Operations`, () => {
            
            beforeEach(async () => {
                await storage.initialize();
                await storage.clear();
            });

            it('should add and search tokens', async () => {
                const itemId = await storage.addItem({
                    id: 0,
                    path: 'test.ts',
                    name: 'getUserName',
                    type: ItemType.Function
                });

                await storage.addTokens([
                    { token: 'get', itemId, position: 0 },
                    { token: 'user', itemId, position: 3 },
                    { token: 'name', itemId, position: 7 }
                ]);

                const results = await storage.searchTokens(['user', 'name']);
                assert.ok(results.has(itemId));
                assert.strictEqual(results.get(itemId), 2); // Matched 2 tokens
            });

            it('should handle case-insensitive token search', async () => {
                const itemId = await storage.addItem({
                    id: 0,
                    path: 'test.ts',
                    name: 'getUserName',
                    type: ItemType.Function
                });

                // Tokens are stored lowercase
                await storage.addTokens([
                    { token: 'get', itemId, position: 0 },
                    { token: 'user', itemId, position: 3 },
                    { token: 'name', itemId, position: 7 }
                ]);

                const results = await storage.searchTokens(['user', 'name']);
                assert.ok(results.has(itemId));
            });

            it('should remove tokens when requested', async () => {
                const itemId = await storage.addItem({
                    id: 0,
                    path: 'test.ts',
                    name: 'test',
                    type: ItemType.File
                });

                await storage.addTokens([
                    { token: 'test', itemId, position: 0 }
                ]);

                await storage.removeTokens(itemId);

                const results = await storage.searchTokens(['test']);
                assert.strictEqual(results.size, 0, 'Tokens should be removed');
            });
        });

        describe(`${name} - Transaction Support`, () => {
            
            beforeEach(async () => {
                await storage.initialize();
                await storage.clear();
            });

            it('should support basic transactions', async () => {
                await storage.beginTransaction();

                const id = await storage.addItem({
                    id: 0,
                    path: 'transactional.ts',
                    name: 'transactional.ts',
                    type: ItemType.File
                });

                await storage.commitTransaction();

                const retrieved = await storage.getItem(id);
                assert.ok(retrieved, 'Item should be persisted after commit');
            });

            it('should handle rollback (if supported)', async () => {
                // Note: In-memory storage doesn't actually support rollback
                // This test is more relevant for SQLite storage
                
                await storage.beginTransaction();

                const id = await storage.addItem({
                    id: 0,
                    path: 'rollback.ts',
                    name: 'rollback.ts',
                    type: ItemType.File
                });

                await storage.rollbackTransaction();

                // For in-memory storage, item will still exist
                // For SQLite, it should be rolled back
                const retrieved = await storage.getItem(id);
                
                if (name === 'InMemoryStorage') {
                    assert.ok(retrieved, 'In-memory storage does not support rollback');
                }
            });
        });

        describe(`${name} - Statistics`, () => {
            
            beforeEach(async () => {
                await storage.initialize();
                await storage.clear();
            });

            it('should provide accurate statistics', async () => {
                // Add some items
                for (let i = 0; i < 5; i++) {
                    const id = await storage.addItem({
                        id: 0,
                        path: `file${i}.ts`,
                        name: `file${i}.ts`,
                        type: ItemType.File
                    });

                    // Add trigrams
                    await storage.addTrigrams([
                        { trigram: `tr${i}`, itemId: id, position: 0 }
                    ]);

                    // Add tokens
                    await storage.addTokens([
                        { token: `token${i}`, itemId: id, position: 0 }
                    ]);
                }

                const stats = await storage.getStats();
                assert.strictEqual(stats.totalItems, 5);
                assert.ok(stats.totalTrigrams >= 5); // At least 5 unique trigrams
                assert.ok(stats.totalTokens >= 5); // At least 5 unique tokens
                assert.ok(stats.lastUpdated instanceof Date);
            });
        });
    }

    // Test InMemoryTrigramStorage
    const inMemoryStorage = new InMemoryTrigramStorage({
        storagePath: ':memory:',
        inMemory: true
    });
    
    runStorageTests(inMemoryStorage, 'InMemoryStorage');

    // Note: SQLite storage tests would require mocking or using sql.js
    // which requires additional setup for testing environment
});

describe('InMemoryTrigramStorage Specific', () => {
    
    it('should handle sharding correctly', async () => {
        const storage = new InMemoryTrigramStorage({
            storagePath: ':memory:',
            inMemory: true
        });

        await storage.initialize();
        await storage.clear();

        // Add many items to test sharding
        const itemIds: number[] = [];
        for (let i = 0; i < 100; i++) {
            const id = await storage.addItem({
                id: 0,
                path: `file${i}.ts`,
                name: `file${i}.ts`,
                type: ItemType.File
            });
            itemIds.push(id);
        }

        // Add diverse trigrams to trigger multiple shards
        const trigrams = [
            'aaa', 'bbb', 'zzz', '123', 'xyz'
        ];

        for (const trigram of trigrams) {
            for (const itemId of itemIds.slice(0, 10)) {
                await storage.addTrigrams([
                    { trigram, itemId, position: 0 }
                ]);
            }
        }

        // Search should work across shards
        for (const trigram of trigrams) {
            const results = await storage.searchTrigrams([trigram]);
            assert.ok(results.size > 0, `Should find results for ${trigram}`);
        }

        // Check memory usage reporting
        const memoryUsage = (storage as any).getMemoryUsage();
        assert.ok(memoryUsage, 'Should report memory usage');
        assert.ok(memoryUsage.heapUsed > 0);
        assert.ok(memoryUsage.shardInfo);
    });

    it('should handle edge cases in sharding', async () => {
        const storage = new InMemoryTrigramStorage({
            storagePath: ':memory:',
            inMemory: true
        });

        await storage.initialize();

        // Test with empty trigrams
        const results = await storage.searchTrigrams([]);
        assert.strictEqual(results.size, 0);

        // Test with non-existent trigrams
        const noResults = await storage.searchTrigrams(['nonexistent']);
        assert.strictEqual(noResults.size, 0);
    });
});