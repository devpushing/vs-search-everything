import * as vscode from 'vscode';
import * as path from 'path';
import { SearchProvider, SearchItem, SearchItemType } from '../types/search';

export class FileSearchProvider implements SearchProvider {
    private fileCache: Map<string, vscode.Uri> = new Map();
    private lastCacheUpdate: number = 0;
    private readonly CACHE_DURATION = 5000; // 5 seconds

    constructor(private excludePatterns: string[]) {}

    async search(query: string): Promise<SearchItem[]> {
        await this.updateCacheIfNeeded();
        
        const results: SearchItem[] = [];
        const lowerQuery = query.toLowerCase();
        
        // Check if query contains kind filter
        const kindMatch = lowerQuery.match(/\b(file|files)\b/);
        const hasKindFilter = kindMatch !== null;
        const searchQuery = hasKindFilter 
            ? lowerQuery.replace(/\b(file|files)\b/g, '').trim() 
            : lowerQuery;

        for (const [filePath, uri] of this.fileCache) {
            const matchScore = this.getMatchScore(filePath, searchQuery, hasKindFilter);
            if (matchScore > 0) {
                const item = this.createSearchItem(uri, filePath);
                (item as any).matchScore = matchScore;
                results.push(item);
            }
        }

        return results.sort((a, b) => {
            // Sort by match score (higher is better)
            const scoreA = (a as any).matchScore || 0;
            const scoreB = (b as any).matchScore || 0;
            if (scoreA !== scoreB) return scoreB - scoreA;
            
            // Then by path length
            return a.label.length - b.label.length;
        });
    }

    private async updateCacheIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.CACHE_DURATION) {
            return;
        }

        this.fileCache.clear();
        const files = await vscode.workspace.findFiles(
            '**/*',
            `{${this.excludePatterns.join(',')}}`
        );

        for (const file of files) {
            const relativePath = vscode.workspace.asRelativePath(file);
            this.fileCache.set(relativePath, file);
        }

        this.lastCacheUpdate = now;
    }

    private getMatchScore(filePath: string, query: string, hasKindFilter: boolean): number {
        if (!query) return hasKindFilter ? 100 : 1; // If only kind filter, return all files
        
        const fileName = path.basename(filePath).toLowerCase();
        const fullPath = filePath.toLowerCase();
        
        let score = 0;

        // Exact match gets highest score
        if (fileName === query) {
            score = 1000;
        } else if (fullPath === query) {
            score = 900;
        }
        // Contains match
        else if (fileName.includes(query)) {
            score = 500;
        } else if (fullPath.includes(query)) {
            score = 400;
        }
        // Fuzzy match
        else if (this.fuzzyMatch(fileName, query)) {
            score = 200;
        } else if (this.fuzzyMatch(fullPath, query)) {
            score = 100;
        }

        // Boost score if kind filter is used
        if (hasKindFilter && score > 0) {
            score += 50;
        }

        return score;
    }

    private fuzzyMatch(str: string, pattern: string): boolean {
        let patternIdx = 0;
        let strIdx = 0;

        while (strIdx < str.length && patternIdx < pattern.length) {
            if (str[strIdx] === pattern[patternIdx]) {
                patternIdx++;
            }
            strIdx++;
        }

        return patternIdx === pattern.length;
    }

    private createSearchItem(uri: vscode.Uri, filePath: string): SearchItem {
        const fileName = path.basename(filePath);
        const dirPath = path.dirname(filePath);

        return {
            label: fileName,
            description: `${filePath} • File`,
            detail: undefined,
            type: SearchItemType.File,
            uri: uri,
            alwaysShow: true
        };
    }
}