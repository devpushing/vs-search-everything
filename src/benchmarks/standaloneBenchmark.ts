#!/usr/bin/env node

import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { execSync } from 'child_process';
import { TrigramUtils } from '../utils/trigramUtils';

// Minimal types needed for benchmark
interface TrigramItem {
    id: number;
    path: string;
    name: string;
    type: number;
}

interface BenchmarkResult {
    storage: string;
    operation: string;
    itemCount: number;
    duration: number;
    throughput: number;
    memoryUsed?: number;
}

// Simple in-memory storage for benchmarking
class SimpleInMemoryStorage {
    private items = new Map<number, TrigramItem>();
    private itemsByPath = new Map<string, TrigramItem>();
    private trigrams = new Map<string, Set<number>>();
    private tokens = new Map<string, Set<number>>();
    private nextId = 1;

    async clear(): Promise<void> {
        this.items.clear();
        this.itemsByPath.clear();
        this.trigrams.clear();
        this.tokens.clear();
        this.nextId = 1;
    }

    async addItem(item: TrigramItem): Promise<number> {
        const id = this.nextId++;
        const newItem = { ...item, id };
        this.items.set(id, newItem);
        this.itemsByPath.set(item.path, newItem);
        return id;
    }

    async addTrigrams(matches: Array<{ trigram: string; itemId: number }>): Promise<void> {
        for (const match of matches) {
            if (!this.trigrams.has(match.trigram)) {
                this.trigrams.set(match.trigram, new Set());
            }
            this.trigrams.get(match.trigram)!.add(match.itemId);
        }
    }

    async addTokens(matches: Array<{ token: string; itemId: number }>): Promise<void> {
        for (const match of matches) {
            if (!this.tokens.has(match.token)) {
                this.tokens.set(match.token, new Set());
            }
            this.tokens.get(match.token)!.add(match.itemId);
        }
    }

    async searchTrigrams(trigrams: string[]): Promise<Map<number, number>> {
        const scores = new Map<number, number>();
        for (const trigram of trigrams) {
            const itemSet = this.trigrams.get(trigram);
            if (itemSet) {
                for (const itemId of itemSet) {
                    scores.set(itemId, (scores.get(itemId) || 0) + 1);
                }
            }
        }
        return scores;
    }

    async searchTokens(tokens: string[]): Promise<Map<number, number>> {
        const scores = new Map<number, number>();
        for (const token of tokens) {
            const itemSet = this.tokens.get(token);
            if (itemSet) {
                for (const itemId of itemSet) {
                    scores.set(itemId, (scores.get(itemId) || 0) + 1);
                }
            }
        }
        return scores;
    }

    getStats() {
        return {
            items: this.items.size,
            trigrams: this.trigrams.size,
            tokens: this.tokens.size
        };
    }
}

class StorageBenchmark {
    private results: BenchmarkResult[] = [];
    private testDataPath: string;
    private fileList: string[] = [];

    constructor() {
        this.testDataPath = path.join(process.cwd(), 'benchmark-data');
    }

    async prepareTestData(): Promise<void> {
        console.log('📦 Preparing test data...');
        
        if (!fs.existsSync(this.testDataPath)) {
            fs.mkdirSync(this.testDataPath, { recursive: true });
        }

        // Try Linux kernel first
        const linuxPath = path.join(this.testDataPath, 'linux');
        if (fs.existsSync(linuxPath)) {
            console.log('📂 Using existing Linux kernel source...');
            this.fileList = this.collectFiles(linuxPath);
        } else {
            console.log('📥 Would clone Linux kernel, but using synthetic data for quick test...');
            await this.generateSyntheticData();
        }
        
        console.log(`Found ${this.fileList.length} files for testing`);
    }

    private collectFiles(dir: string): string[] {
        const files: string[] = [];
        const extensions = ['.c', '.h', '.cpp', '.hpp', '.cc', '.hh', '.py', '.sh', '.pl', '.rs', '.go', '.java', '.ts', '.js'];
        
        const walk = (currentPath: string) => {
            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    
                    if (entry.isDirectory()) {
                        if (!['node_modules', '.git', 'Documentation', 'tools'].includes(entry.name)) {
                            walk(fullPath);
                        }
                    } else if (entry.isFile()) {
                        if (extensions.some(ext => entry.name.endsWith(ext))) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch (error) {
                // Skip unreadable directories
            }
        };
        
        walk(dir);
        return files;
    }

    private async generateSyntheticData(): Promise<void> {
        console.log('🔨 Generating synthetic test data...');
        const syntheticPath = path.join(this.testDataPath, 'synthetic');
        
        if (!fs.existsSync(syntheticPath)) {
            fs.mkdirSync(syntheticPath, { recursive: true });
        }

        const components = [
            ['get', 'set', 'handle', 'process', 'create', 'delete', 'update', 'find', 'fetch', 'load'],
            ['User', 'Data', 'Config', 'Manager', 'Service', 'Controller', 'Handler', 'Provider', 'Factory', 'Builder'],
            ['Request', 'Response', 'Cache', 'Buffer', 'Stream', 'File', 'Network', 'Database', 'Session', 'Token']
        ];

        // Generate 5000 files for quick testing
        const targetFiles = 5000;
        for (let i = 0; i < targetFiles; i++) {
            const dir = path.join(syntheticPath, `module_${Math.floor(i / 100)}`);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const fileName = `${components[0][i % 10]}${components[1][(i * 3) % 10]}${components[2][(i * 7) % 10]}.ts`;
            const filePath = path.join(dir, fileName);
            this.fileList.push(filePath);
            
            // Don't actually create files, just use the paths
        }
        
        console.log(`Generated ${this.fileList.length} synthetic file paths`);
    }

    private getMemoryUsage(): number {
        const usage = process.memoryUsage();
        return usage.heapUsed / 1024 / 1024; // MB
    }

    async benchmarkStorage(storage: SimpleInMemoryStorage, storageType: string, fileLimit: number): Promise<void> {
        console.log(`\n📊 Benchmarking ${storageType}...`);
        
        const files = this.fileList.slice(0, fileLimit);
        
        // Indexing benchmark
        const startMemory = this.getMemoryUsage();
        const startTime = performance.now();
        
        await storage.clear();
        
        for (const filePath of files) {
            const relativePath = path.relative(this.testDataPath, filePath);
            const fileName = path.basename(filePath);
            
            // Add item
            const itemId = await storage.addItem({
                id: 0,
                path: relativePath,
                name: fileName,
                type: 0
            });
            
            // Generate trigrams
            const searchText = `${fileName} ${relativePath}`;
            const processedText = TrigramUtils.preprocessForIndexing(searchText);
            const trigramsWithPos = TrigramUtils.generateTrigramsWithPositions(processedText, false);
            
            if (trigramsWithPos.length > 0) {
                const trigramMatches = trigramsWithPos.map(t => ({
                    trigram: t.trigram,
                    itemId: itemId,
                    position: t.position
                }));
                await storage.addTrigrams(trigramMatches);
            }
            
            // Generate tokens
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions(searchText);
            if (tokensWithPos.length > 0) {
                const tokenMatches = tokensWithPos.map(t => ({
                    token: t.token.toLowerCase(),
                    itemId: itemId,
                    position: t.position
                }));
                await storage.addTokens(tokenMatches);
            }
        }
        
        const indexTime = performance.now() - startTime;
        const memoryUsed = this.getMemoryUsage() - startMemory;
        
        this.results.push({
            storage: storageType,
            operation: 'indexing',
            itemCount: files.length,
            duration: indexTime,
            throughput: (files.length / indexTime) * 1000,
            memoryUsed: memoryUsed
        });
        
        const stats = storage.getStats();
        console.log(`✅ Indexed ${files.length} files in ${(indexTime / 1000).toFixed(2)}s`);
        console.log(`   Memory: ${memoryUsed.toFixed(1)} MB`);
        console.log(`   Stats:`, stats);
        
        // Search benchmarks
        console.log(`\n🔍 Running search benchmarks...`);
        
        const queries = [
            'get', 'set', 'config', 'handle',
            'processData', 'getUserName', 'init'
        ];
        
        for (const query of queries) {
            const iterations = 100;
            const searchStart = performance.now();
            let matches = 0;
            
            for (let i = 0; i < iterations; i++) {
                const trigrams = TrigramUtils.generateTrigrams(query, false);
                const results = await storage.searchTrigrams(trigrams);
                if (i === 0) matches = results.size;
            }
            
            const searchTime = (performance.now() - searchStart) / iterations;
            
            this.results.push({
                storage: storageType,
                operation: `search: ${query}`,
                itemCount: matches,
                duration: searchTime,
                throughput: 1000 / searchTime
            });
            
            console.log(`  "${query}": ${searchTime.toFixed(2)}ms, ${matches} matches`);
        }
    }

    printResults(): void {
        console.log('\n📈 RESULTS SUMMARY');
        console.log('═'.repeat(60));
        
        const indexing = this.results.filter(r => r.operation === 'indexing');
        const searches = this.results.filter(r => r.operation.startsWith('search:'));
        
        if (indexing.length > 0) {
            console.log('\nIndexing Performance:');
            console.log('─'.repeat(60));
            for (const result of indexing) {
                console.log(`  Files: ${result.itemCount}`);
                console.log(`  Time: ${(result.duration / 1000).toFixed(2)}s`);
                console.log(`  Throughput: ${result.throughput.toFixed(0)} files/sec`);
                console.log(`  Memory: ${result.memoryUsed?.toFixed(1)} MB`);
            }
        }
        
        if (searches.length > 0) {
            console.log('\nSearch Performance (avg over 100 iterations):');
            console.log('─'.repeat(60));
            console.log('Query'.padEnd(20) + 'Time(ms)'.padEnd(12) + 'Matches');
            console.log('─'.repeat(60));
            for (const result of searches) {
                const query = result.operation.replace('search: ', '');
                console.log(
                    query.padEnd(20) +
                    result.duration.toFixed(2).padEnd(12) +
                    result.itemCount
                );
            }
        }
        
        console.log('═'.repeat(60));
    }

    async run(): Promise<void> {
        console.log('🚀 Trigram Storage Benchmark\n');
        
        await this.prepareTestData();
        
        const testSizes = [1000, 5000, 10000];
        
        for (const size of testSizes) {
            if (size > this.fileList.length) continue;
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Testing with ${size} files`);
            console.log('='.repeat(60));
            
            const storage = new SimpleInMemoryStorage();
            await this.benchmarkStorage(storage, `InMemory-${size}`, size);
        }
        
        this.printResults();
    }
}

// Run benchmark
if (require.main === module) {
    const benchmark = new StorageBenchmark();
    benchmark.run()
        .then(() => {
            console.log('\n✅ Benchmark completed successfully!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Benchmark failed:', error);
            process.exit(1);
        });
}