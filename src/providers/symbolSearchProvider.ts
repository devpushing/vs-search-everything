import * as vscode from 'vscode';
import { SearchProvider, SearchItem, SearchItemType } from '../types/search';

export class SymbolSearchProvider implements SearchProvider {
    private symbolCache: vscode.SymbolInformation[] = [];
    private lastCacheUpdate: number = 0;
    private readonly CACHE_DURATION = 10000; // 10 seconds

    async search(query: string): Promise<SearchItem[]> {
        await this.updateCacheIfNeeded();
        
        const results: SearchItem[] = [];
        const lowerQuery = query.toLowerCase();
        
        // Extract kind filters from query
        const kindFilters = this.extractKindFilters(lowerQuery);
        const searchQuery = this.removeKindFilters(lowerQuery);

        for (const symbol of this.symbolCache) {
            const matchScore = this.getMatchScore(symbol, searchQuery, kindFilters);
            if (matchScore > 0) {
                const item = this.createSearchItem(symbol);
                (item as any).matchScore = matchScore;
                results.push(item);
            }
        }

        return results.sort((a, b) => {
            // Sort by match score (higher is better)
            const scoreA = (a as any).matchScore || 0;
            const scoreB = (b as any).matchScore || 0;
            if (scoreA !== scoreB) return scoreB - scoreA;
            
            // Then by type priority
            const typePriority = this.getTypePriority(a.type) - this.getTypePriority(b.type);
            if (typePriority !== 0) return typePriority;
            
            return a.label.length - b.label.length;
        });
    }

    private async updateCacheIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastCacheUpdate < this.CACHE_DURATION) {
            return;
        }

        try {
            this.symbolCache = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                ''
            ) || [];
            this.lastCacheUpdate = now;
        } catch (error) {
            console.error('Failed to fetch workspace symbols:', error);
            this.symbolCache = [];
        }
    }

    private extractKindFilters(query: string): string[] {
        const kindKeywords = [
            'class', 'classes', 'method', 'methods', 'function', 'functions',
            'variable', 'variables', 'interface', 'interfaces', 'enum', 'enums',
            'namespace', 'namespaces', 'symbol', 'symbols'
        ];
        
        const filters: string[] = [];
        for (const keyword of kindKeywords) {
            if (query.match(new RegExp(`\\b${keyword}\\b`))) {
                filters.push(keyword.replace(/s$/, '')); // Remove plural 's'
            }
        }
        
        return filters;
    }

    private removeKindFilters(query: string): string {
        return query
            .replace(/\b(class|classes|method|methods|function|functions|variable|variables|interface|interfaces|enum|enums|namespace|namespaces|symbol|symbols)\b/g, '')
            .trim();
    }

    private getMatchScore(symbol: vscode.SymbolInformation, query: string, kindFilters: string[]): number {
        const symbolKind = this.getSymbolKindLabel(symbol.kind).toLowerCase();
        
        // Check if symbol matches kind filter
        if (kindFilters.length > 0) {
            const matchesKind = kindFilters.some(filter => 
                symbolKind === filter || 
                (filter === 'symbol') // 'symbol' matches any symbol
            );
            if (!matchesKind) return 0;
        }
        
        // If no search query (only kind filter), return base score
        if (!query) return kindFilters.length > 0 ? 100 : 1;
        
        const lowerName = symbol.name.toLowerCase();
        let score = 0;

        // Exact match gets highest score
        if (lowerName === query) {
            score = 1000;
        }
        // Contains match
        else if (lowerName.includes(query)) {
            score = 500;
        }
        // Fuzzy match
        else if (this.fuzzyMatch(lowerName, query)) {
            score = 200;
        }

        // Boost score if kind filter is used
        if (kindFilters.length > 0 && score > 0) {
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

    private createSearchItem(symbol: vscode.SymbolInformation): SearchItem {
        const type = this.mapSymbolKindToType(symbol.kind);
        const containerName = symbol.containerName || undefined;
        const fileName = symbol.location.uri.path.split('/').pop() || '';
        const kindLabel = this.getSymbolKindLabel(symbol.kind);

        const relativePath = vscode.workspace.asRelativePath(symbol.location.uri);
        
        return {
            label: `$(symbol-${type}) ${symbol.name}`,
            description: `${relativePath} • ${kindLabel}`,
            detail: undefined,
            type: type,
            uri: symbol.location.uri,
            range: symbol.location.range,
            containerName: containerName,
            alwaysShow: true
        };
    }

    private mapSymbolKindToType(kind: vscode.SymbolKind): SearchItemType {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return SearchItemType.Class;
            case vscode.SymbolKind.Method:
                return SearchItemType.Method;
            case vscode.SymbolKind.Function:
                return SearchItemType.Function;
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Constant:
                return SearchItemType.Variable;
            case vscode.SymbolKind.Interface:
                return SearchItemType.Interface;
            case vscode.SymbolKind.Enum:
                return SearchItemType.Enum;
            case vscode.SymbolKind.Namespace:
            case vscode.SymbolKind.Module:
                return SearchItemType.Namespace;
            default:
                return SearchItemType.Variable;
        }
    }

    private getTypePriority(type: SearchItemType): number {
        const priorities: Record<SearchItemType, number> = {
            [SearchItemType.Class]: 1,
            [SearchItemType.Interface]: 2,
            [SearchItemType.Enum]: 3,
            [SearchItemType.Function]: 4,
            [SearchItemType.Method]: 5,
            [SearchItemType.Namespace]: 6,
            [SearchItemType.Variable]: 7,
            [SearchItemType.File]: 8
        };
        return priorities[type] || 99;
    }

    private getSymbolKindLabel(kind: vscode.SymbolKind): string {
        switch (kind) {
            case vscode.SymbolKind.Class:
                return 'Class';
            case vscode.SymbolKind.Method:
                return 'Method';
            case vscode.SymbolKind.Function:
                return 'Function';
            case vscode.SymbolKind.Variable:
                return 'Variable';
            case vscode.SymbolKind.Constant:
                return 'Constant';
            case vscode.SymbolKind.Interface:
                return 'Interface';
            case vscode.SymbolKind.Enum:
                return 'Enum';
            case vscode.SymbolKind.Namespace:
                return 'Namespace';
            case vscode.SymbolKind.Module:
                return 'Module';
            case vscode.SymbolKind.Property:
                return 'Property';
            case vscode.SymbolKind.Field:
                return 'Field';
            case vscode.SymbolKind.Constructor:
                return 'Constructor';
            case vscode.SymbolKind.EnumMember:
                return 'Enum Member';
            case vscode.SymbolKind.Struct:
                return 'Struct';
            case vscode.SymbolKind.Event:
                return 'Event';
            case vscode.SymbolKind.Operator:
                return 'Operator';
            case vscode.SymbolKind.TypeParameter:
                return 'Type Parameter';
            default:
                return 'Symbol';
        }
    }
}