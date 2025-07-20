import * as path from 'path';
import * as fs from 'fs';
// @ts-ignore - sql.js doesn't have TypeScript types
import initSqlJs from 'sql.js';
import * as vscode from 'vscode';
import {
    TrigramStorageAdapter,
    TrigramItem,
    TrigramMatch,
    CamelCaseToken,
    IndexStats,
    TrigramStorageConfig
} from '../types/trigramIndex';
import { logger } from '../utils/logger';

export class SqliteTrigramStorage implements TrigramStorageAdapter {
    private db: any = null; // sql.js Database instance
    private SQL: any = null; // sql.js module
    private config: TrigramStorageConfig;
    private dbPath: string;
    private inTransaction = false;
    private saveTimer: NodeJS.Timeout | null = null;
    private batchOperations = 0;
    private readonly BATCH_SIZE = 1000;
    private autoCommit = true;

    constructor(config: TrigramStorageConfig) {
        this.config = config;
        this.dbPath = config.inMemory ? ':memory:' : config.storagePath;
    }

    async initialize(): Promise<void> {
        try {
            logger.log('Starting SQL.js initialization...');
            
            // Initialize sql.js with proper WASM file location
            this.SQL = await initSqlJs({
                locateFile: (filename: string) => {
                    if (filename.endsWith('.wasm')) {
                        // Try multiple strategies to find the WASM file
                        
                        // Strategy 1: Use VS Code's extension context if available
                        if (this.config.extensionPath) {
                            const wasmPath = path.join(this.config.extensionPath, 'node_modules', 'sql.js', 'dist', filename);
                            logger.log(`Trying WASM path: ${wasmPath}`);
                            return vscode.Uri.file(wasmPath).toString();
                        }
                        
                        // Strategy 2: Use CDN as fallback
                        const cdnUrl = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${filename}`;
                        logger.log(`Using CDN for WASM: ${cdnUrl}`);
                        return cdnUrl;
                    }
                    return filename;
                }
            });

            logger.log('SQL.js module loaded successfully');
            
            if (!this.SQL) {
                throw new Error('Failed to load SQL.js module');
            }

            // Load existing database or create new one
            if (!this.config.inMemory && fs.existsSync(this.dbPath)) {
                // Load existing database from file
                const fileBuffer = fs.readFileSync(this.dbPath);
                this.db = new this.SQL.Database(fileBuffer);
                logger.log('Loaded existing SQLite database from file');
            } else {
                // Create new database
                this.db = new this.SQL.Database();
                logger.log('Created new SQLite database');
            }

            // Configure for performance
            this.db.run('PRAGMA journal_mode = WAL');
            this.db.run('PRAGMA synchronous = NORMAL');
            this.db.run('PRAGMA cache_size = -64000'); // 64MB cache
            this.db.run('PRAGMA temp_store = MEMORY');
            this.db.run('PRAGMA mmap_size = 268435456'); // 256MB memory map
            
            // Create schema
            this.createSchema();
            
            // Schedule periodic saves for non-memory databases
            if (!this.config.inMemory) {
                this.scheduleSave();
            }
            
            logger.log('SQLite trigram storage initialized');
        } catch (error) {
            logger.error('Failed to initialize SQLite storage:', error);
            throw error;
        }
    }

    private createSchema(): void {
        if (!this.db) throw new Error('Database not initialized');

        // Create tables
        this.db.run(`
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                type INTEGER NOT NULL,
                parent_id INTEGER,
                metadata TEXT,
                FOREIGN KEY (parent_id) REFERENCES items(id) ON DELETE CASCADE
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS trigrams (
                trigram TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (trigram, item_id, position),
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS tokens (
                token TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (token, item_id, position),
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
            )
        `);

        this.db.run(`
            CREATE TABLE IF NOT EXISTS stats (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        // Create indexes for performance
        this.db.run('CREATE INDEX IF NOT EXISTS idx_items_path ON items(path)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_trigrams_trigram ON trigrams(trigram)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_trigrams_item ON trigrams(item_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_tokens_item ON tokens(item_id)');
    }

    private scheduleSave(): void {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // Save every 5 seconds if there were changes
        this.saveTimer = setTimeout(() => {
            this.saveToFile();
            this.scheduleSave();
        }, 5000);
    }

    private saveToFile(): void {
        if (!this.config.inMemory && this.db) {
            try {
                // Ensure directory exists
                const dir = path.dirname(this.dbPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // Export database to buffer and write to file
                const data = this.db.export();
                fs.writeFileSync(this.dbPath, Buffer.from(data));
            } catch (error) {
                logger.error('Failed to save database to file:', error);
            }
        }
    }

    async close(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        
        // Commit any pending transaction
        if (this.inTransaction) {
            try {
                await this.commitTransaction();
            } catch (e) {
                logger.error('Error committing transaction during close:', e);
            }
        }
        
        if (this.db) {
            this.saveToFile();
            this.db.close();
            this.db = null;
        }
    }

    async clear(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        // Force reset transaction state to handle any orphaned transactions
        if (this.inTransaction) {
            logger.log('Warning: Transaction was active during clear, rolling back');
            try {
                this.db.run('ROLLBACK');
            } catch (e) {
                // Ignore rollback errors
            }
            this.inTransaction = false;
        }
        
        this.db.run('DELETE FROM trigrams');
        this.db.run('DELETE FROM tokens');
        this.db.run('DELETE FROM items');
        this.db.run('DELETE FROM stats');
        this.db.run('VACUUM');
    }

    // Batch control methods
    setAutoCommit(enabled: boolean): void {
        this.autoCommit = enabled;
    }

    // Item management
    async addItem(item: TrigramItem): Promise<number> {
        if (!this.db) throw new Error('Database not initialized');

        // Start transaction if not already started
        if (!this.inTransaction && this.autoCommit) {
            await this.beginTransaction();
        }

        const stmt = this.db.prepare(`
            INSERT INTO items (path, name, type, parent_id, metadata)
            VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run([
            item.path,
            item.name,
            item.type,
            item.parentId || null,
            item.metadata ? JSON.stringify(item.metadata) : null
        ]);
        
        stmt.free();
        
        // Get the last inserted ID
        const result = this.db.exec('SELECT last_insert_rowid() as id');
        const id = result[0].values[0][0];
        
        // Auto-commit after batch size only if autoCommit is enabled
        if (this.autoCommit) {
            this.batchOperations++;
            if (this.batchOperations >= this.BATCH_SIZE && this.inTransaction) {
                await this.commitTransaction();
                this.batchOperations = 0;
            }
        }
        
        return id;
    }

    async updateItem(id: number, item: Partial<TrigramItem>): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');

        const updates: string[] = [];
        const values: any[] = [];

        if (item.path !== undefined) {
            updates.push('path = ?');
            values.push(item.path);
        }
        if (item.name !== undefined) {
            updates.push('name = ?');
            values.push(item.name);
        }
        if (item.type !== undefined) {
            updates.push('type = ?');
            values.push(item.type);
        }
        if (item.parentId !== undefined) {
            updates.push('parent_id = ?');
            values.push(item.parentId);
        }
        if (item.metadata !== undefined) {
            updates.push('metadata = ?');
            values.push(JSON.stringify(item.metadata));
        }

        if (updates.length === 0) return;

        values.push(id);
        const stmt = this.db.prepare(`
            UPDATE items SET ${updates.join(', ')} WHERE id = ?
        `);
        stmt.run(values);
        stmt.free();
    }

    async deleteItem(id: number): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.run('DELETE FROM items WHERE id = ?', [id]);
    }

    async getItem(id: number): Promise<TrigramItem | null> {
        if (!this.db) throw new Error('Database not initialized');

        const result = this.db.exec('SELECT * FROM items WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }

        return this.rowToItem(result[0]);
    }

    async getItemByPath(path: string): Promise<TrigramItem | null> {
        if (!this.db) throw new Error('Database not initialized');

        const result = this.db.exec('SELECT * FROM items WHERE path = ?', [path]);
        if (result.length === 0 || result[0].values.length === 0) {
            return null;
        }

        return this.rowToItem(result[0]);
    }

    async getAllItems(): Promise<TrigramItem[]> {
        if (!this.db) throw new Error('Database not initialized');

        const result = this.db.exec('SELECT * FROM items');
        if (result.length === 0) {
            return [];
        }

        return result[0].values.map((row: any[]) => this.rowToItemArray(result[0].columns, row));
    }

    // Trigram management
    async addTrigrams(trigrams: TrigramMatch[]): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (trigrams.length === 0) return;

        // Start transaction if not already started
        if (!this.inTransaction && this.autoCommit) {
            await this.beginTransaction();
        }

        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO trigrams (trigram, item_id, position)
            VALUES (?, ?, ?)
        `);

        for (const t of trigrams) {
            stmt.run([t.trigram, t.itemId, t.position]);
        }
        
        stmt.free();
        
        // Count batch operations only if autoCommit is enabled
        if (this.autoCommit) {
            this.batchOperations += trigrams.length;
            if (this.batchOperations >= this.BATCH_SIZE && this.inTransaction) {
                await this.commitTransaction();
                this.batchOperations = 0;
            }
        }
    }

    async removeTrigrams(itemId: number): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.run('DELETE FROM trigrams WHERE item_id = ?', [itemId]);
    }

    async searchTrigrams(trigrams: string[]): Promise<Map<number, number>> {
        if (!this.db) throw new Error('Database not initialized');
        if (trigrams.length === 0) return new Map();

        const placeholders = trigrams.map(() => '?').join(',');
        const query = `
            SELECT item_id, COUNT(DISTINCT trigram) as match_count
            FROM trigrams
            WHERE trigram IN (${placeholders})
            GROUP BY item_id
            HAVING match_count = ?
        `;

        const result = this.db.exec(query, [...trigrams, trigrams.length]);
        const map = new Map<number, number>();
        
        if (result.length > 0) {
            for (const row of result[0].values) {
                map.set(row[0], row[1]);
            }
        }
        
        return map;
    }

    // CamelCase token management
    async addTokens(tokens: CamelCaseToken[]): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (tokens.length === 0) return;

        // Start transaction if not already started
        if (!this.inTransaction && this.autoCommit) {
            await this.beginTransaction();
        }

        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO tokens (token, item_id, position)
            VALUES (?, ?, ?)
        `);

        for (const t of tokens) {
            stmt.run([t.token, t.itemId, t.position]);
        }
        
        stmt.free();
        
        // Count batch operations only if autoCommit is enabled
        if (this.autoCommit) {
            this.batchOperations += tokens.length;
            if (this.batchOperations >= this.BATCH_SIZE && this.inTransaction) {
                await this.commitTransaction();
                this.batchOperations = 0;
            }
        }
    }

    async removeTokens(itemId: number): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.run('DELETE FROM tokens WHERE item_id = ?', [itemId]);
    }

    async searchTokens(tokens: string[]): Promise<Map<number, number>> {
        if (!this.db) throw new Error('Database not initialized');
        if (tokens.length === 0) return new Map();

        const placeholders = tokens.map(() => '?').join(',');
        const query = `
            SELECT item_id, COUNT(DISTINCT token) as match_count
            FROM tokens
            WHERE token IN (${placeholders})
            GROUP BY item_id
        `;

        const result = this.db.exec(query, tokens);
        const map = new Map<number, number>();
        
        if (result.length > 0) {
            for (const row of result[0].values) {
                map.set(row[0], row[1]);
            }
        }
        
        return map;
    }

    // Transaction management
    async beginTransaction(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (this.inTransaction) {
            logger.log('Warning: Transaction already in progress - skipping BEGIN');
            return;
        }

        try {
            this.db.run('BEGIN TRANSACTION');
            this.inTransaction = true;
            this.batchOperations = 0; // Reset batch counter
        } catch (error) {
            this.inTransaction = false;
            this.batchOperations = 0;
            throw error;
        }
    }

    async commitTransaction(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!this.inTransaction) {
            logger.log('Warning: Attempting to commit with no transaction in progress');
            return;
        }

        try {
            this.db.run('COMMIT');
            this.inTransaction = false;
            this.batchOperations = 0; // Reset batch counter on commit
            logger.log('Transaction committed successfully');
        } catch (error) {
            // Reset transaction state on error
            this.inTransaction = false;
            this.batchOperations = 0;
            logger.error('Error committing transaction:', error);
            throw error;
        }
    }

    async rollbackTransaction(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        if (!this.inTransaction) {
            logger.log('Warning: Attempting to rollback with no transaction in progress');
            return;
        }

        try {
            this.db.run('ROLLBACK');
        } finally {
            this.inTransaction = false;
        }
    }

    // Statistics
    async getStats(): Promise<IndexStats> {
        if (!this.db) throw new Error('Database not initialized');

        const stats = {
            totalItems: 0,
            totalTrigrams: 0,
            totalTokens: 0,
            indexSizeBytes: 0,
            lastUpdated: new Date()
        };

        // Get counts using SQL queries
        let result = this.db.exec('SELECT COUNT(*) FROM items');
        stats.totalItems = result[0]?.values[0][0] || 0;

        result = this.db.exec('SELECT COUNT(DISTINCT trigram) FROM trigrams');
        stats.totalTrigrams = result[0]?.values[0][0] || 0;

        result = this.db.exec('SELECT COUNT(DISTINCT token) FROM tokens');
        stats.totalTokens = result[0]?.values[0][0] || 0;

        // Get file size
        if (!this.config.inMemory && fs.existsSync(this.dbPath)) {
            const fileStats = fs.statSync(this.dbPath);
            stats.indexSizeBytes = fileStats.size;
        }

        // Get last updated
        result = this.db.exec("SELECT value FROM stats WHERE key = 'last_updated'");
        if (result[0]?.values[0]) {
            stats.lastUpdated = new Date(result[0].values[0][0]);
        }

        return stats;
    }

    // Ensure any pending operations are committed
    async flush(): Promise<void> {
        if (this.inTransaction) {
            await this.commitTransaction();
            this.batchOperations = 0;
        }
    }

    // Storage optimization
    async optimize(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        
        // Ensure all pending operations are committed first
        await this.flush();

        this.db.run('ANALYZE');
        this.db.run('PRAGMA optimize');
    }

    async vacuum(): Promise<void> {
        if (!this.db) throw new Error('Database not initialized');
        this.db.run('VACUUM');
    }

    // Helper methods
    private rowToItem(result: any): TrigramItem {
        const columns = result.columns;
        const row = result.values[0];
        const item: any = {};
        
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            const value = row[i];
            
            if (col === 'parent_id') {
                item.parentId = value;
            } else if (col === 'metadata' && value) {
                item.metadata = JSON.parse(value);
            } else {
                item[col] = value;
            }
        }
        
        return item as TrigramItem;
    }

    private rowToItemArray(columns: string[], row: any[]): TrigramItem {
        const item: any = {};
        
        for (let i = 0; i < columns.length; i++) {
            const col = columns[i];
            const value = row[i];
            
            if (col === 'parent_id') {
                item.parentId = value;
            } else if (col === 'metadata' && value) {
                item.metadata = JSON.parse(value);
            } else {
                item[col] = value;
            }
        }
        
        return item as TrigramItem;
    }
}