import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { InMemoryTrigramStorage } from '../storage/inMemoryTrigramStorage';
import { SqliteTrigramStorage } from '../storage/sqliteTrigramStorage';
import { TrigramStorageAdapter, TrigramItem, ItemType, TrigramStorageConfig } from '../types/trigramIndex';
import { TrigramUtils } from '../utils/trigramUtils';
import { execSync } from 'child_process';

interface BenchmarkResult {
    storage: string;
    operation: string;
    itemCount: number;
    duration: number;
    throughput: number;
    memoryUsed?: number;
}

interface TestQuery {
    query: string;
    description: string;
    expectedMatches?: number;
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

        // Check if Linux kernel already exists
        const linuxPath = path.join(this.testDataPath, 'linux');
        if (!fs.existsSync(linuxPath)) {
            console.log('📥 Cloning Linux kernel (shallow, no history)...');
            console.log('This will take a few minutes...');
            
            try {
                execSync(
                    `git clone --depth 1 --single-branch --branch master https://github.com/torvalds/linux.git "${linuxPath}"`,
                    { stdio: 'inherit' }
                );
            } catch (error) {
                console.error('Failed to clone Linux kernel:', error);
                console.log('Falling back to synthetic data generation...');
                await this.generateSyntheticData();
                return;
            }
        }

        // Collect all source files
        console.log('🔍 Scanning for source files...');
        this.fileList = this.collectFiles(linuxPath, [
            '*.c', '*.h', '*.cpp', '*.hpp', '*.cc', '*.hh',
            '*.py', '*.sh', '*.pl', '*.rs', '*.go', '*.java'
        ]);
        
        console.log(`Found ${this.fileList.length} source files`);
    }

    private collectFiles(dir: string, patterns: string[]): string[] {
        const files: string[] = [];
        const extensions = patterns.map(p => p.replace('*', ''));
        
        const walk = (currentPath: string) => {
            try {
                const entries = fs.readdirSync(currentPath, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(currentPath, entry.name);
                    
                    if (entry.isDirectory()) {
                        // Skip certain directories
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
                // Skip directories we can't read
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

        const nameParts = [
            'get', 'set', 'handle', 'process', 'create', 'delete', 'update', 'find',
            'User', 'Data', 'Config', 'Manager', 'Service', 'Controller', 'Handler',
            'Request', 'Response', 'Cache', 'Buffer', 'Stream', 'File', 'Network'
        ];

        // Generate 10,000 synthetic files
        for (let i = 0; i < 10000; i++) {
            const dir = path.join(syntheticPath, `module_${Math.floor(i / 100)}`);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const fileName = `${nameParts[i % nameParts.length]}${nameParts[(i * 3) % nameParts.length]}${i}.ts`;
            const filePath = path.join(dir, fileName);
            
            if (!fs.existsSync(filePath)) {
                // Generate some content with symbols
                const content = `
export class ${nameParts[i % nameParts.length]}${nameParts[(i * 2) % nameParts.length]} {
    private ${nameParts[(i * 3) % nameParts.length].toLowerCase()}Data: any;
    
    public get${nameParts[(i * 4) % nameParts.length]}(): void {
        // Implementation
    }
    
    public handle${nameParts[(i * 5) % nameParts.length]}Request(): Promise<void> {
        return Promise.resolve();
    }
}

function process${nameParts[(i * 6) % nameParts.length]}${nameParts[(i * 7) % nameParts.length]}() {
    // Function implementation
}

const ${nameParts[(i * 8) % nameParts.length].toLowerCase()}Config = {
    enabled: true,
    timeout: 5000
};
`;
                fs.writeFileSync(filePath, content);
            }
            
            this.fileList.push(filePath);
        }
        
        console.log(`Generated ${this.fileList.length} synthetic files`);
    }

    private async createStorage(type: 'memory' | 'sqlite'): Promise<TrigramStorageAdapter> {
        const config: TrigramStorageConfig = {
            storagePath: path.join(this.testDataPath, 'trigram.db'),
            inMemory: type === 'memory',
            extensionPath: process.cwd()
        };

        if (type === 'memory') {
            return new InMemoryTrigramStorage(config);
        } else {
            return new SqliteTrigramStorage(config);
        }
    }

    private getMemoryUsage(): number {
        const usage = process.memoryUsage();
        return usage.heapUsed / 1024 / 1024; // MB
    }

    async benchmarkIndexing(storage: TrigramStorageAdapter, storageType: string, fileLimit?: number): Promise<void> {
        console.log(`\n📊 Benchmarking ${storageType} indexing...`);
        
        const files = fileLimit ? this.fileList.slice(0, fileLimit) : this.fileList;
        const startMemory = this.getMemoryUsage();
        const startTime = performance.now();
        
        await storage.initialize();
        await storage.clear();
        
        // Begin transaction for bulk operation
        await storage.beginTransaction();
        
        let indexed = 0;
        const progressInterval = Math.floor(files.length / 10);
        
        for (const filePath of files) {
            const relativePath = path.relative(this.testDataPath, filePath);
            const fileName = path.basename(filePath);
            
            // Add item
            const itemId = await storage.addItem({
                id: 0,
                path: relativePath,
                name: fileName,
                type: ItemType.File
            });
            
            // Generate and add trigrams
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
            
            // Generate CamelCase tokens
            const tokensWithPos = TrigramUtils.extractCamelCaseTokensWithPositions(searchText);
            if (tokensWithPos.length > 0) {
                const tokenMatches = tokensWithPos.map(t => ({
                    token: t.token.toLowerCase(),
                    itemId: itemId,
                    position: t.position
                }));
                await storage.addTokens(tokenMatches);
            }
            
            indexed++;
            if (indexed % progressInterval === 0) {
                console.log(`  Progress: ${indexed}/${files.length} files indexed`);
            }
        }
        
        await storage.commitTransaction();
        
        const endTime = performance.now();
        const endMemory = this.getMemoryUsage();
        const duration = endTime - startTime;
        
        const stats = await storage.getStats();
        
        this.results.push({
            storage: storageType,
            operation: 'indexing',
            itemCount: files.length,
            duration: duration,
            throughput: (files.length / duration) * 1000, // files per second
            memoryUsed: endMemory - startMemory
        });
        
        console.log(`✅ Indexed ${files.length} files in ${(duration / 1000).toFixed(2)}s`);
        console.log(`   Memory used: ${(endMemory - startMemory).toFixed(2)} MB`);
        console.log(`   Stats:`, stats);
    }

    async benchmarkSearch(storage: TrigramStorageAdapter, storageType: string): Promise<void> {
        console.log(`\n🔍 Benchmarking ${storageType} search...`);
        
        const queries: TestQuery[] = [
            { query: 'get', description: 'Short common word' },
            { query: 'set', description: 'Short common word' },
            { query: 'config', description: 'Medium common word' },
            { query: 'handle', description: 'Medium common word' },
            { query: 'processData', description: 'CamelCase' },
            { query: 'getUserName', description: 'Long CamelCase' },
            { query: 'kernel', description: 'Domain specific' },
            { query: 'mutex', description: 'Technical term' },
            { query: 'init', description: 'Common abbreviation' },
            { query: 'tcp_socket', description: 'Snake case' }
        ];

        for (const testQuery of queries) {
            const iterations = 100;
            const startTime = performance.now();
            let totalMatches = 0;
            
            for (let i = 0; i < iterations; i++) {
                const results = await this.searchWithStorage(storage, testQuery.query);
                if (i === 0) {
                    totalMatches = results.size;
                }
            }
            
            const endTime = performance.now();
            const avgDuration = (endTime - startTime) / iterations;
            
            this.results.push({
                storage: storageType,
                operation: `search: ${testQuery.query}`,
                itemCount: totalMatches,
                duration: avgDuration,
                throughput: 1000 / avgDuration // queries per second
            });
            
            console.log(`  Query "${testQuery.query}" (${testQuery.description}): ${avgDuration.toFixed(2)}ms, ${totalMatches} matches`);
        }
    }

    private async searchWithStorage(storage: TrigramStorageAdapter, query: string): Promise<Map<number, number>> {
        const processedQuery = query.trim();
        
        if (processedQuery.length >= 3) {
            const trigrams = TrigramUtils.generateTrigrams(processedQuery, false);
            if (trigrams.length > 0) {
                return await storage.searchTrigrams(trigrams);
            }
        }
        
        // Fallback to token search
        const tokens = TrigramUtils.extractCamelCaseTokens(processedQuery);
        if (tokens.length > 0) {
            const processedTokens = tokens.map(t => t.toLowerCase());
            return await storage.searchTokens(processedTokens);
        }
        
        return new Map();
    }

    printResults(): void {
        console.log('\n📈 Benchmark Results Summary\n');
        console.log('═'.repeat(80));
        
        // Group results by operation type
        const indexingResults = this.results.filter(r => r.operation === 'indexing');
        const searchResults = this.results.filter(r => r.operation.startsWith('search:'));
        
        // Indexing comparison
        if (indexingResults.length > 0) {
            console.log('\n🔨 INDEXING PERFORMANCE');
            console.log('─'.repeat(80));
            console.log('Storage      Files    Time(s)   Files/sec   Memory(MB)');
            console.log('─'.repeat(80));
            
            for (const result of indexingResults) {
                console.log(
                    `${result.storage.padEnd(12)} ${result.itemCount.toString().padEnd(8)} ` +
                    `${(result.duration / 1000).toFixed(2).padEnd(9)} ` +
                    `${result.throughput.toFixed(0).padEnd(11)} ` +
                    `${result.memoryUsed?.toFixed(1) || 'N/A'}`
                );
            }
        }
        
        // Search comparison
        if (searchResults.length > 0) {
            console.log('\n\n🔍 SEARCH PERFORMANCE');
            console.log('─'.repeat(80));
            console.log('Query            In-Memory(ms)  SQLite(ms)  Speedup   Matches');
            console.log('─'.repeat(80));
            
            const queries = [...new Set(searchResults.map(r => r.operation))];
            for (const query of queries) {
                const memResult = searchResults.find(r => r.operation === query && r.storage === 'InMemory');
                const sqliteResult = searchResults.find(r => r.operation === query && r.storage === 'SQLite');
                
                if (memResult && sqliteResult) {
                    const queryName = query.replace('search: ', '').padEnd(16);
                    const speedup = sqliteResult.duration / memResult.duration;
                    
                    console.log(
                        `${queryName} ${memResult.duration.toFixed(2).padEnd(14)} ` +
                        `${sqliteResult.duration.toFixed(2).padEnd(11)} ` +
                        `${speedup.toFixed(1)}x`.padEnd(9) +
                        `${memResult.itemCount}`
                    );
                }
            }
        }
        
        console.log('\n' + '═'.repeat(80));
    }

    async run(): Promise<void> {
        console.log('🚀 Storage Benchmark Suite\n');
        
        // Prepare test data
        await this.prepareTestData();
        
        // Limit files for testing
        const fileLimit = Math.min(this.fileList.length, 10000);
        console.log(`\n📏 Testing with ${fileLimit} files\n`);
        
        // Benchmark in-memory storage
        const memStorage = await this.createStorage('memory');
        await this.benchmarkIndexing(memStorage, 'InMemory', fileLimit);
        await this.benchmarkSearch(memStorage, 'InMemory');
        await memStorage.close();
        
        // Force garbage collection if possible
        if (global.gc) {
            global.gc();
        }
        
        // Benchmark SQLite storage
        const sqliteStorage = await this.createStorage('sqlite');
        await this.benchmarkIndexing(sqliteStorage, 'SQLite', fileLimit);
        await this.benchmarkSearch(sqliteStorage, 'SQLite');
        await sqliteStorage.close();
        
        // Print comparison
        this.printResults();
    }
}

// Run benchmark
if (require.main === module) {
    const benchmark = new StorageBenchmark();
    benchmark.run().catch(console.error);
}

export { StorageBenchmark };